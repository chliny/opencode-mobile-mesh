package cc.agentlabs.opencode.zerotier

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import com.zerotier.sockets.ZeroTierNative
import com.zerotier.sockets.ZeroTierNode
import com.zerotier.sockets.ZeroTierSocket
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val MAX_PLANET_BYTES = 4096
private const val MAX_PLANET_BASE64_CHARS = 8192
private const val DEFAULT_START_TIMEOUT_MS = 30_000L
private const val NODE_ONLINE_TIMEOUT_MS = 30_000L
private const val NETWORK_ASSIGNMENT_SETTLE_MS = 5_000L
private const val NODE_STOP_TIMEOUT_MS = 5_000L
private const val PICK_PLANET_FILE_REQUEST_CODE = 41739

private object OpenCodeZeroTierNative {
  init {
    System.loadLibrary("zt")
  }

  @JvmStatic external fun safeNodeStop(): Int
}

class OpenCodeZeroTierModule : Module() {
  private val controlExecutor = Executors.newSingleThreadExecutor()
  private val relayExecutor = Executors.newCachedThreadPool()
  private val lock = Any()

  @Volatile private var node: ZeroTierNode? = null
  @Volatile private var relay: AppLocalRelay? = null
  @Volatile private var currentKey: String? = null
  @Volatile private var status: Map<String, Any?> = mapOf("state" to "stopped")
  private var pendingPlanetPickerPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("OpenCodeZeroTier")

    AsyncFunction("start") { options: Map<String, Any?>, promise: Promise ->
      controlExecutor.execute {
        try {
          promise.resolve(startInternal(options))
        } catch (error: Throwable) {
          val nodeId = node?.let { current -> formatNodeId(current.id) }
          val message = buildString {
            append(error.message ?: error.javaClass.simpleName)
            if (nodeId != null) append(" (ZeroTier node ID: $nodeId)")
          }
          stopInternal()
          status = mapOf("state" to "error", "error" to message, "nodeId" to nodeId)
          promise.reject("ERR_ZEROTIER_START", message, error)
        }
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      controlExecutor.execute {
        stopInternal()
        promise.resolve(null)
      }
    }

    AsyncFunction("getStatus") {
      status
    }

    AsyncFunction("installPlanet") { uri: String, _displayName: String?, promise: Promise ->
      controlExecutor.execute {
        try {
          promise.resolve(installPlanet(uri))
        } catch (error: Throwable) {
          promise.reject("ERR_PLANET_IMPORT", error.message ?: "Unable to import planet", error)
        }
      }
    }

    AsyncFunction("installPlanetBase64") { encoded: String, promise: Promise ->
      controlExecutor.execute {
        try {
          promise.resolve(installPlanetBase64(encoded))
        } catch (error: Throwable) {
          promise.reject("ERR_PLANET_IMPORT", error.message ?: "Unable to decode planet Base64", error)
        }
      }
    }

    AsyncFunction("pickPlanetFile") { promise: Promise ->
      check(pendingPlanetPickerPromise == null) { "A planet file picker is already open" }
      pendingPlanetPickerPromise = promise
      try {
        // ACTION_GET_CONTENT models this operation as importing a copy. Asking
        // for */* lets file providers expose extensionless planet files as well
        // as files with arbitrary names, extensions, and MIME classifications.
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
          type = "*/*"
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        appContext.throwingActivity.startActivityForResult(
          Intent.createChooser(intent, null),
          PICK_PLANET_FILE_REQUEST_CODE,
        )
      } catch (error: Throwable) {
        pendingPlanetPickerPromise = null
        promise.reject("ERR_PLANET_PICKER", error.message ?: "Unable to open file picker", error)
      }
    }

    OnActivityResult { _, (requestCode, resultCode, intent) ->
      if (requestCode != PICK_PLANET_FILE_REQUEST_CODE) return@OnActivityResult
      val promise = pendingPlanetPickerPromise ?: return@OnActivityResult
      pendingPlanetPickerPromise = null

      if (resultCode != Activity.RESULT_OK) {
        promise.resolve(null)
        return@OnActivityResult
      }

      val uri = intent?.data
      if (uri == null) {
        promise.reject("ERR_PLANET_PICKER", "The selected file has no readable URI", null)
        return@OnActivityResult
      }

      controlExecutor.execute {
        try {
          promise.resolve(installPlanet(uri.toString()))
        } catch (error: Throwable) {
          promise.reject("ERR_PLANET_IMPORT", error.message ?: "Unable to import planet", error)
        }
      }
    }

    AsyncFunction("removePlanet") { id: String ->
      require(id.matches(Regex("^[a-f0-9]{64}$"))) { "Invalid planet id" }
      planetDirectory(id).deleteRecursively()
      legacyPlanetFile(id).delete()
    }

    OnDestroy {
      stopInternal()
      controlExecutor.shutdownNow()
      relayExecutor.shutdownNow()
    }
  }

  private fun startInternal(options: Map<String, Any?>): Map<String, Any?> = synchronized(lock) {
    val profileId = requireString(options, "profileId")
    require(profileId.matches(Regex("^[A-Za-z0-9_-]{1,80}$"))) { "Invalid profile id" }
    val networkIdText = requireString(options, "networkId").lowercase()
    require(networkIdText.matches(Regex("^[0-9a-f]{16}$"))) { "Network ID must contain exactly 16 hexadecimal characters" }
    val networkId = java.lang.Long.parseUnsignedLong(networkIdText, 16)
    val remoteHost = requireString(options, "remoteHost")
    val remotePort = (options["remotePort"] as? Number)?.toInt() ?: 0
    require(remotePort in 1..65535) { "Invalid ZeroTier server port" }
    val planetId = (options["planetId"] as? String)?.takeIf { it.isNotBlank() }
    val forceRestart = options["forceRestart"] as? Boolean ?: false
    if (planetId != null) {
      require(planetId.matches(Regex("^[a-f0-9]{64}$"))) { "Invalid planet id" }
      require(resolvePlanetFile(planetId)?.isFile == true) { "Configured planet file is missing" }
    }
    val timeoutMs = ((options["timeoutMs"] as? Number)?.toLong() ?: DEFAULT_START_TIMEOUT_MS).coerceIn(5_000L, 120_000L)
    val key = listOf(profileId, networkIdText, remoteHost, remotePort, planetId ?: "default").joinToString("|")

    val existingNode = node
    if (!forceRestart && currentKey == key && existingNode != null) {
      if (
        status["state"] == "ready" &&
        existingNode.isOnline() &&
        assignedAddress(existingNode, networkId) != null &&
        relay != null
      ) return status

      relay?.close()
      relay = null
      waitForNodeOnline(existingNode, timeoutMs)
      checkResult(existingNode.join(networkId), "join network")
      return finishNetworkJoin(existingNode, networkId, remoteHost, remotePort)
    }

    relay?.close()
    relay = null
    node?.let {
      stopNodeAndWait(it)
      node = null
    }

    status = mapOf("state" to "starting", "phase" to "starting_node")
    val storage = File(nodesDirectory(), profileId).apply { mkdirs() }
    val roots = File(storage, "roots")
    if (planetId == null) {
      roots.delete()
    } else {
      resolvePlanetFile(planetId)!!.copyTo(roots, overwrite = true)
    }

    val nextNode = ZeroTierNode()
    checkResult(nextNode.initFromStorage(storage.absolutePath), "initialize node storage")
    // A custom roots file is authoritative and must not be replaced by a
    // controller-delivered planet update. Default roots retain normal caching.
    checkResult(nextNode.initAllowRootsCache(planetId == null), "configure roots cache")
    checkResult(nextNode.start(), "start node")
    node = nextNode

    waitForNodeOnline(nextNode, timeoutMs)

    val nodeId = formatNodeId(nextNode.id)
    status = mapOf("state" to "starting", "phase" to "joining_network", "nodeId" to nodeId)
    checkResult(nextNode.join(networkId), "join network")
    currentKey = key
    return finishNetworkJoin(nextNode, networkId, remoteHost, remotePort)
  }

  private fun waitForNodeOnline(currentNode: ZeroTierNode, timeoutMs: Long) {
    val onlineDeadline = System.currentTimeMillis() + minOf(timeoutMs, NODE_ONLINE_TIMEOUT_MS)
    while (!currentNode.isOnline() && System.currentTimeMillis() < onlineDeadline) Thread.sleep(50)
    if (!currentNode.isOnline()) throw IOException("ZeroTier node did not come online before timeout")
  }

  private fun finishNetworkJoin(
    currentNode: ZeroTierNode,
    networkId: Long,
    remoteHost: String,
    remotePort: Int,
  ): Map<String, Any?> {
    val nodeId = formatNodeId(currentNode.id)
    val settleDeadline = System.currentTimeMillis() + NETWORK_ASSIGNMENT_SETTLE_MS
    var assignedAddress = assignedAddress(currentNode, networkId)
    var networkStatus = ZeroTierNative.zts_net_get_status(networkId)
    while (assignedAddress == null && System.currentTimeMillis() < settleDeadline) {
      networkStatus = ZeroTierNative.zts_net_get_status(networkId)
      when (networkStatus) {
        3 -> throw IOException("ZeroTier network was not found")
        4 -> throw IOException("ZeroTier network initialization failed")
        5 -> throw IOException("The embedded ZeroTier core is too old for this network")
      }
      Thread.sleep(150)
      assignedAddress = assignedAddress(currentNode, networkId)
    }

    if (assignedAddress == null) {
      val networkStatusLabel = networkStatusName(networkStatus)
      val message = when (networkStatus) {
        0 -> "ZeroTier node ${nodeId ?: "unknown"} is still requesting network configuration; retry the connection"
        1 -> "ZeroTier node ${nodeId ?: "unknown"} is authorized but has no managed IP address; assign an IP in the network controller, then retry"
        2 -> "Authorize ZeroTier node ${nodeId ?: "unknown"} in the network controller, then retry the connection"
        else -> "ZeroTier node ${nodeId ?: "unknown"} has no assigned address (network status: $networkStatusLabel); retry the connection"
      }
      status = mapOf(
        "state" to "awaiting_authorization",
        "phase" to "waiting_authorization",
        "nodeId" to nodeId,
        "networkStatus" to networkStatusLabel,
        "error" to message,
      )
      return status
    }
    networkStatus = ZeroTierNative.zts_net_get_status(networkId)

    // Resolve hostnames with Android's normal resolver, then pass only numeric
    // addresses into libzt. The resulting TCP socket still belongs entirely to
    // libzt and does not use Android's system socket/VPN path.
    val remoteAddresses = InetAddress.getAllByName(remoteHost)
      .mapNotNull { it.hostAddress }
      .distinct()
    if (remoteAddresses.isEmpty()) throw IOException("ZeroTier server hostname did not resolve")

    lateinit var nextRelay: AppLocalRelay
    nextRelay = AppLocalRelay(remoteHost, remoteAddresses, remotePort, relayExecutor) { error ->
      if (relay === nextRelay) {
        status = mapOf(
          "state" to "error",
          "nodeId" to nodeId,
          "assignedAddress" to assignedAddress,
          "networkStatus" to networkStatusName(networkStatus),
          "remoteHost" to remoteHost,
          "resolvedAddresses" to remoteAddresses,
          "error" to error.message,
        )
      }
    }.also { it.start() }
    relay = nextRelay
    status = mapOf(
      "state" to "ready",
      "baseUrl" to "http://127.0.0.1:${nextRelay.localPort}",
      "nodeId" to nodeId,
      "assignedAddress" to assignedAddress,
      "networkStatus" to networkStatusName(networkStatus),
      "remoteHost" to remoteHost,
      "resolvedAddresses" to remoteAddresses,
    )
    return status
  }

  private fun stopInternal() = synchronized(lock) {
    relay?.close()
    relay = null
    node?.let { stopNodeAndWait(it) }
    node = null
    currentKey = null
    status = mapOf("state" to "stopped")
  }

  private fun stopNodeAndWait(currentNode: ZeroTierNode) {
    runCatching { OpenCodeZeroTierNative.safeNodeStop() }
    val deadline = System.currentTimeMillis() + NODE_STOP_TIMEOUT_MS
    while (System.currentTimeMillis() < deadline) {
      if (!runCatching { currentNode.isOnline() }.getOrDefault(false)) return
      Thread.sleep(50)
    }
  }

  private fun installPlanet(uriText: String): Map<String, Any> {
    val context = requireContext()
    val uri = Uri.parse(uriText)
    val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
      val buffer = ByteArray(MAX_PLANET_BYTES + 1)
      var offset = 0
      while (offset < buffer.size) {
        val read = input.read(buffer, offset, buffer.size - offset)
        if (read < 0) break
        offset += read
      }
      require(offset in 1..MAX_PLANET_BYTES) { "Planet must be between 1 and $MAX_PLANET_BYTES bytes" }
      buffer.copyOf(offset)
    } ?: throw IOException("Unable to open selected planet file")

    return installPlanetBytes(bytes)
  }

  private fun installPlanetBase64(encoded: String): Map<String, Any> {
    val input = encoded.trim()
    require(input.isNotEmpty()) { "Planet Base64 cannot be empty" }
    require(input.length <= MAX_PLANET_BASE64_CHARS) { "Planet Base64 is too large" }
    val bytes = try {
      Base64.decode(input, Base64.DEFAULT)
    } catch (error: IllegalArgumentException) {
      throw IllegalArgumentException("Planet Base64 is invalid", error)
    }
    return installPlanetBytes(bytes)
  }

  private fun installPlanetBytes(bytes: ByteArray): Map<String, Any> {
    require(bytes.size in 1..MAX_PLANET_BYTES) { "Planet must be between 1 and $MAX_PLANET_BYTES bytes" }
    val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    val installedFile = File(planetDirectory(sha).apply { mkdirs() }, "planet")
    installedFile.writeBytes(bytes)
    legacyPlanetFile(sha).delete()
    return mapOf(
      "id" to sha,
      // The source filename and MIME type are intentionally ignored. Inside
      // the app every imported file uses ZeroTier's canonical filename.
      "name" to "planet",
      "sha256" to sha,
      "size" to bytes.size,
    )
  }

  private fun requireContext(): Context =
    appContext.reactContext?.applicationContext ?: throw IllegalStateException("Android context is unavailable")

  private fun planetsDirectory() = File(requireContext().noBackupFilesDir, "zerotier/planets").apply { mkdirs() }
  private fun planetDirectory(id: String) = File(planetsDirectory(), id)
  private fun legacyPlanetFile(id: String) = File(planetsDirectory(), "$id.planet")
  private fun resolvePlanetFile(id: String): File? =
    File(planetDirectory(id), "planet").takeIf { it.isFile }
      ?: legacyPlanetFile(id).takeIf { it.isFile }
  private fun nodesDirectory() = File(requireContext().noBackupFilesDir, "zerotier/nodes").apply { mkdirs() }

  private fun requireString(options: Map<String, Any?>, key: String): String =
    (options[key] as? String)?.trim()?.takeIf { it.isNotEmpty() }
      ?: throw IllegalArgumentException("Missing $key")

  private fun checkResult(code: Int, operation: String) {
    if (code < 0) throw IOException("Failed to $operation (libzt error $code)")
  }

  private fun formatNodeId(id: Long): String? =
    id.takeIf { it != 0L }?.let { java.lang.Long.toUnsignedString(it, 16).padStart(10, '0') }

  private fun assignedAddress(node: ZeroTierNode, networkId: Long): String? {
    if (ZeroTierNative.zts_addr_is_assigned(networkId, ZeroTierNative.ZTS_AF_INET) == 1) {
      return node.getIPv4Address(networkId)?.hostAddress
    }
    if (ZeroTierNative.zts_addr_is_assigned(networkId, ZeroTierNative.ZTS_AF_INET6) == 1) {
      return node.getIPv6Address(networkId)?.hostAddress
    }
    return null
  }

  private fun networkStatusName(status: Int): String = when (status) {
    0 -> "requesting_configuration"
    1 -> "authorized"
    2 -> "access_denied_or_awaiting_authorization"
    3 -> "network_not_found"
    4 -> "port_error"
    5 -> "client_too_old"
    else -> "pending"
  }

}

private class AppLocalRelay(
  private val remoteHost: String,
  private val remoteAddresses: List<String>,
  private val remotePort: Int,
  private val executor: ExecutorService,
  private val onConnectError: (IOException) -> Unit,
) : Closeable {
  private val running = AtomicBoolean(false)
  private val clients = Collections.synchronizedSet(mutableSetOf<RelayConnection>())
  private val server = ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"))
  val localPort: Int get() = server.localPort

  fun start() {
    running.set(true)
    executor.execute {
      while (running.get()) {
        var local: Socket? = null
        try {
          val accepted = server.accept()
          local = accepted
          accepted.tcpNoDelay = true
          val connection = RelayConnection(accepted, connectRemote()) { clients.remove(it) }
          clients.add(connection)
          connection.start(executor)
          local = null // RelayConnection owns it now.
        } catch (error: IOException) {
          runCatching { local?.close() }
          if (!running.get()) break
          onConnectError(error)
        }
      }
    }
  }

  private fun connectRemote(): ZeroTierSocket {
    var lastError: IOException? = null
    for (address in remoteAddresses) {
      val family = if (address.contains(':')) ZeroTierNative.ZTS_AF_INET6 else ZeroTierNative.ZTS_AF_INET
      var socket: ZeroTierSocket? = null
      try {
        socket = ZeroTierSocket(family, ZeroTierNative.ZTS_SOCK_STREAM, 0)
        socket.connect(address, remotePort)
        return socket
      } catch (error: IOException) {
        runCatching { socket?.close() }
        lastError = error
      }
    }
    val detail = lastError?.message?.let { ": $it" }.orEmpty()
    throw IOException(
      "libzt relay could not connect to $remoteHost:$remotePort " +
        "via [${remoteAddresses.joinToString()}]$detail",
      lastError,
    )
  }

  override fun close() {
    if (!running.getAndSet(false)) return
    runCatching { server.close() }
    synchronized(clients) { clients.toList().forEach { it.close() } }
    clients.clear()
  }
}

private class RelayConnection(
  private val local: Socket,
  private val remote: ZeroTierSocket,
  private val onClose: (RelayConnection) -> Unit,
) : Closeable {
  private val closed = AtomicBoolean(false)

  fun start(executor: ExecutorService) {
    executor.execute { pipe(local.getInputStream(), remote.outputStream) }
    executor.execute { pipe(remote.inputStream, local.getOutputStream()) }
  }

  private fun pipe(input: java.io.InputStream, output: java.io.OutputStream) {
    try {
      input.copyTo(output, 16 * 1024)
      output.flush()
    } catch (_: IOException) {
      // The opposite direction or lifecycle shutdown closes both sockets.
    } finally {
      close()
    }
  }

  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    runCatching { local.close() }
    runCatching { remote.close() }
    onClose(this)
  }
}

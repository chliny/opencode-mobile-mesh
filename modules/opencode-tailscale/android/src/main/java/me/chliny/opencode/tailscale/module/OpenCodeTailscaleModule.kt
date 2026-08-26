package me.chliny.opencode.tailscale.module

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.NetworkInterface
import java.util.concurrent.Executors

private object OpenCodeTailscaleNative {
  init {
    System.loadLibrary("opencode_tsnet")
    System.loadLibrary("opencode_tsnet_jni")
  }

  @JvmStatic external fun startNative(
    stateDirectory: String,
    hostname: String,
    remoteHost: String,
    remotePort: Int,
  ): String

  @JvmStatic external fun stopNative(): String

  @JvmStatic external fun statusNative(): String

  @JvmStatic external fun networkChangedNative(available: Boolean, networkType: String, at: Long)
  @JvmStatic external fun setInterfacesNative(interfaces: String)
}

class OpenCodeTailscaleModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private var connectivityManager: ConnectivityManager? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  override fun definition() = ModuleDefinition {
    Name("OpenCodeTailscale")
    Events("networkChanged")

    OnCreate {
      val context = appContext.reactContext?.applicationContext ?: return@OnCreate
      connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = publishNetworkState(network, true)
        override fun onLost(network: Network) = publishNetworkState(network, false)
      }
      runCatching { connectivityManager?.registerDefaultNetworkCallback(networkCallback!!) }
    }

    AsyncFunction("start") { options: Map<String, Any?>, promise: Promise ->
      executor.execute {
        try {
          val profileId = requireString(options, "profileId")
          require(profileId.matches(Regex("^[A-Za-z0-9_-]{1,80}$"))) { "Invalid profile id" }
          val remoteHost = requireString(options, "remoteHost")
          val remotePort = (options["remotePort"] as? Number)?.toInt() ?: 0
          require(remotePort in 1..65535) { "Invalid Tailscale server port" }
          val hostname = (options["hostname"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
            ?: "opencode-$profileId"
          require(hostname.matches(Regex("^[A-Za-z0-9-]{1,63}$"))) { "Invalid Tailscale hostname" }

          val context = appContext.reactContext?.applicationContext
            ?: throw IllegalStateException("Android context is unavailable")
          if (!hasValidatedInternet()) {
            promise.resolve(mapOf(
              "state" to "error",
              "phase" to "network_unavailable",
              "networkAvailable" to false,
              "diagnosticCode" to "network_unavailable",
              "diagnosticMessage" to "Android has no validated internet connection",
              "error" to "No internet connection. Connect to Wi-Fi or mobile data, then retry Tailscale.",
            ))
            return@execute
          }
          val stateDirectory = File(context.noBackupFilesDir, "tailscale/$profileId").apply { mkdirs() }
          OpenCodeTailscaleNative.setInterfacesNative(networkInterfaces())
          promise.resolve(jsonToMap(OpenCodeTailscaleNative.startNative(
            stateDirectory.absolutePath,
            hostname,
            remoteHost,
            remotePort,
          )))
        } catch (error: Throwable) {
          promise.reject("ERR_TAILSCALE_START", error.message ?: "Unable to start embedded Tailscale", error)
        }
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      executor.execute {
        try {
          jsonToMap(OpenCodeTailscaleNative.stopNative())
          promise.resolve(null)
        } catch (error: Throwable) {
          promise.reject("ERR_TAILSCALE_STOP", error.message ?: "Unable to stop embedded Tailscale", error)
        }
      }
    }

    AsyncFunction("getStatus") {
      jsonToMap(OpenCodeTailscaleNative.statusNative())
    }

    OnDestroy {
      runCatching { networkCallback?.let { connectivityManager?.unregisterNetworkCallback(it) } }
      OpenCodeTailscaleNative.stopNative()
      executor.shutdownNow()
    }
  }

  private fun publishNetworkState(network: Network, available: Boolean) {
    val activeNetwork = connectivityManager?.activeNetwork
    val effectiveAvailable = available || activeNetwork != null
    val typeNetwork = if (available) network else activeNetwork ?: network
    val type = connectivityManager?.getNetworkCapabilities(typeNetwork)?.let(::networkType) ?: "unknown"
    val at = System.currentTimeMillis()
    runCatching { OpenCodeTailscaleNative.networkChangedNative(effectiveAvailable, type, at) }
    sendEvent("networkChanged", mapOf("available" to effectiveAvailable, "type" to type, "at" to at))
  }

  private fun hasValidatedInternet(): Boolean {
    val network = connectivityManager?.activeNetwork ?: return false
    val capabilities = connectivityManager?.getNetworkCapabilities(network) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
  }

  private fun networkInterfaces(): String {
    val interfaces = JSONArray()
    val values = runCatching { NetworkInterface.getNetworkInterfaces() }.getOrNull() ?: return interfaces.toString()
    while (values.hasMoreElements()) {
      val network = values.nextElement()
      if (!runCatching { network.isUp && !network.isLoopback }.getOrDefault(false)) continue
      val addresses = JSONArray()
      network.interfaceAddresses.forEach { address ->
        val host = address.address.hostAddress ?: return@forEach
        addresses.put("$host/${address.networkPrefixLength}")
      }
      interfaces.put(JSONObject().apply {
        put("name", network.name)
        put("index", network.index)
        put("addresses", addresses)
      })
    }
    return interfaces.toString()
  }

  private fun networkType(capabilities: NetworkCapabilities): String = when {
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
    else -> "other"
  }

  private fun requireString(options: Map<String, Any?>, key: String): String =
    (options[key] as? String)?.trim()?.takeIf { it.isNotEmpty() }
      ?: throw IllegalArgumentException("Missing $key")

  private fun jsonToMap(value: String): Map<String, Any?> = jsonObjectToMap(JSONObject(value))

  private fun jsonObjectToMap(value: JSONObject): Map<String, Any?> = buildMap {
    val keys = value.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      put(key, jsonValue(value.get(key)))
    }
  }

  private fun jsonArrayToList(value: JSONArray): List<Any?> = List(value.length()) { index -> jsonValue(value.get(index)) }

  private fun jsonValue(value: Any?): Any? = when (value) {
    JSONObject.NULL -> null
    is JSONObject -> jsonObjectToMap(value)
    is JSONArray -> jsonArrayToList(value)
    else -> value
  }
}

package me.chliny.opencode.tailscale.module

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
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
}

class OpenCodeTailscaleModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("OpenCodeTailscale")

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
          val stateDirectory = File(context.noBackupFilesDir, "tailscale/$profileId").apply { mkdirs() }
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
      OpenCodeTailscaleNative.stopNative()
      executor.shutdownNow()
    }
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

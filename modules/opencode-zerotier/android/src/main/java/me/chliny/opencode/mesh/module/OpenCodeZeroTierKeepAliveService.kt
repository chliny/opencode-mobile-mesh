package me.chliny.opencode.mesh.module

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

private const val KEEP_ALIVE_CHANNEL_ID = "zerotier_connection"
private const val KEEP_ALIVE_NOTIFICATION_ID = 17291

class OpenCodeZeroTierKeepAliveService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createChannel()
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, KEEP_ALIVE_CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    val notification = builder
      .setContentTitle("Maintaining ZeroTier connection")
      .setContentText("OpenCode Mobile will reconnect faster when you return")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(KEEP_ALIVE_NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(KEEP_ALIVE_NOTIFICATION_ID, notification)
    }
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      KEEP_ALIVE_CHANNEL_ID,
      "ZeroTier connection",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  companion object {
    fun start(context: Context) {
      val intent = Intent(context, OpenCodeZeroTierKeepAliveService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, OpenCodeZeroTierKeepAliveService::class.java))
    }
  }
}

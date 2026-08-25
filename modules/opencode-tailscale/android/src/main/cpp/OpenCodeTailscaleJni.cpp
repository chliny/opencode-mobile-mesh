#include <jni.h>

extern "C" {
char* TailscaleStart(const char* stateDir, const char* hostname, const char* authKey,
                     const char* remoteHost, int remotePort);
char* TailscaleStop();
char* TailscaleStatus();
void TailscaleFree(char* value);
}

namespace {
jstring toJString(JNIEnv* env, char* value) {
  jstring result = env->NewStringUTF(value);
  TailscaleFree(value);
  return result;
}
}

extern "C" JNIEXPORT jstring JNICALL
Java_me_chliny_opencode_tailscale_module_OpenCodeTailscaleNative_startNative(
    JNIEnv* env,
    jclass,
    jstring stateDir,
    jstring hostname,
    jstring authKey,
    jstring remoteHost,
    jint remotePort) {
  const char* stateDirChars = env->GetStringUTFChars(stateDir, nullptr);
  const char* hostnameChars = env->GetStringUTFChars(hostname, nullptr);
  const char* authKeyChars = env->GetStringUTFChars(authKey, nullptr);
  const char* remoteHostChars = env->GetStringUTFChars(remoteHost, nullptr);
  char* result = TailscaleStart(stateDirChars, hostnameChars, authKeyChars, remoteHostChars, remotePort);
  env->ReleaseStringUTFChars(stateDir, stateDirChars);
  env->ReleaseStringUTFChars(hostname, hostnameChars);
  env->ReleaseStringUTFChars(authKey, authKeyChars);
  env->ReleaseStringUTFChars(remoteHost, remoteHostChars);
  return toJString(env, result);
}

extern "C" JNIEXPORT jstring JNICALL
Java_me_chliny_opencode_tailscale_module_OpenCodeTailscaleNative_stopNative(JNIEnv* env, jclass) {
  return toJString(env, TailscaleStop());
}

extern "C" JNIEXPORT jstring JNICALL
Java_me_chliny_opencode_tailscale_module_OpenCodeTailscaleNative_statusNative(JNIEnv* env, jclass) {
  return toJString(env, TailscaleStatus());
}

#include <jni.h>

extern "C" {
char* TailscaleStart(const char* stateDir, const char* hostname, const char* remoteHost,
                     int remotePort);
char* TailscaleStop();
char* TailscaleStatus();
void TailscaleNetworkChanged(int available, const char* networkType, long long at);
void TailscaleSetInterfaces(const char* value);
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
    jstring remoteHost,
    jint remotePort) {
  const char* stateDirChars = env->GetStringUTFChars(stateDir, nullptr);
  const char* hostnameChars = env->GetStringUTFChars(hostname, nullptr);
  const char* remoteHostChars = env->GetStringUTFChars(remoteHost, nullptr);
  char* result = TailscaleStart(stateDirChars, hostnameChars, remoteHostChars, remotePort);
  env->ReleaseStringUTFChars(stateDir, stateDirChars);
  env->ReleaseStringUTFChars(hostname, hostnameChars);
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

extern "C" JNIEXPORT void JNICALL
Java_me_chliny_opencode_tailscale_module_OpenCodeTailscaleNative_networkChangedNative(
    JNIEnv* env, jclass, jboolean available, jstring networkType, jlong at) {
  const char* networkTypeChars = env->GetStringUTFChars(networkType, nullptr);
  TailscaleNetworkChanged(available ? 1 : 0, networkTypeChars, at);
  env->ReleaseStringUTFChars(networkType, networkTypeChars);
}

extern "C" JNIEXPORT void JNICALL
Java_me_chliny_opencode_tailscale_module_OpenCodeTailscaleNative_setInterfacesNative(
    JNIEnv* env, jclass, jstring value) {
  const char* chars = env->GetStringUTFChars(value, nullptr);
  TailscaleSetInterfaces(chars);
  env->ReleaseStringUTFChars(value, chars);
}

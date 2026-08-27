#include <jni.h>
#include <errno.h>

namespace {
jobject activeNetwork = nullptr;
JavaVM* javaVm = nullptr;
jmethodID bindSocketMethod = nullptr;
}

extern "C" jint JNI_OnLoad(JavaVM* vm, void*) {
  javaVm = vm;
  JNIEnv* env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    return JNI_ERR;
  }
jclass networkClass = env->FindClass("android/net/Network");
  bindSocketMethod = env->GetMethodID(networkClass, "bindSocket", "(Ljava/io/FileDescriptor;)V");
  env->DeleteLocalRef(networkClass);
  return bindSocketMethod ? JNI_VERSION_1_6 : JNI_ERR;
}

extern "C" int TailscaleBindSocket(int fd) {
  if (!javaVm || !activeNetwork || !bindSocketMethod) return ENODEV;
  JNIEnv* env = nullptr;
  bool attached = false;
  const jint envResult = javaVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
  if (envResult == JNI_EDETACHED) {
    if (javaVm->AttachCurrentThread(&env, nullptr) != JNI_OK) return EIO;
    attached = true;
  } else if (envResult != JNI_OK) {
    return EIO;
  }
  jclass fileDescriptorClass = env->FindClass("java/io/FileDescriptor");
  jmethodID constructor = env->GetMethodID(fileDescriptorClass, "<init>", "()V");
  jfieldID descriptor = env->GetFieldID(fileDescriptorClass, "descriptor", "I");
  jobject fileDescriptor = nullptr;
  if (constructor && descriptor) {
    fileDescriptor = env->NewObject(fileDescriptorClass, constructor);
    env->SetIntField(fileDescriptor, descriptor, static_cast<jint>(fd));
  }
  if (fileDescriptor) env->CallVoidMethod(activeNetwork, bindSocketMethod, fileDescriptor);
  env->DeleteLocalRef(fileDescriptorClass);
  if (fileDescriptor) env->DeleteLocalRef(fileDescriptor);
  const bool failed = env->ExceptionCheck();
  if (failed) env->ExceptionClear();
  if (attached) javaVm->DetachCurrentThread();
  return failed ? EPERM : 0;
}

extern "C" {
char* TailscaleStart(const char* stateDir, const char* hostname, const char* remoteHost,
                     int remotePort);
char* TailscaleStop();
char* TailscaleStatus();
void TailscaleNetworkChanged(int available, const char* networkType, long long at);
void TailscaleSetInterfaces(const char* value);
void TailscaleSetDefaultRoute(const char* interfaceName, const char* gateway);
int TailscaleBindSocket(int fd);
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

extern "C" JNIEXPORT void JNICALL
Java_me_chliny_opencode_tailscale_module_OpenCodeTailscaleNative_setDefaultRouteNative(
    JNIEnv* env, jclass, jstring interfaceName, jstring gateway) {
  const char* interfaceChars = env->GetStringUTFChars(interfaceName, nullptr);
  const char* gatewayChars = env->GetStringUTFChars(gateway, nullptr);
  TailscaleSetDefaultRoute(interfaceChars, gatewayChars);
  env->ReleaseStringUTFChars(interfaceName, interfaceChars);
  env->ReleaseStringUTFChars(gateway, gatewayChars);
}

extern "C" JNIEXPORT void JNICALL
Java_me_chliny_opencode_tailscale_module_OpenCodeTailscaleNative_setNetworkNative(
    JNIEnv* env, jclass, jobject network) {
  if (activeNetwork) {
    env->DeleteGlobalRef(activeNetwork);
    activeNetwork = nullptr;
  }
  if (network) activeNetwork = env->NewGlobalRef(network);
}

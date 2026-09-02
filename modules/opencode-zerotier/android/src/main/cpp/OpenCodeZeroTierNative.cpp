#include <jni.h>

#include "ZeroTierSockets.h"

extern "C" JNIEXPORT jint JNICALL
Java_me_chliny_opencode_mesh_module_OpenCodeZeroTierNative_safeNodeStop(
    JNIEnv*,
    jclass)
{
    // JavaSockets.cxx detaches the calling JVM-owned thread after
    // zts_node_stop(), which ART rejects with SIGABRT. This JNI entry point is
    // invoked from Java, so the VM remains responsible for thread attachment.
    return zts_node_stop();
}

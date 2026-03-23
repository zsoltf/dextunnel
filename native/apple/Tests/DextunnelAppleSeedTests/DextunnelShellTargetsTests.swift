import Testing
#if canImport(DextunnelMenuBarHostShell)
import DextunnelMenuBarHostShell
#endif
#if canImport(DextunnelNativeAppSupport)
import DextunnelNativeAppSupport
#endif
#if canImport(DextunnelUniversalIOSShell)
import DextunnelUniversalIOSShell
#endif

@Test
func shellTargetsCompileIntoThePackage() {
    #if canImport(DextunnelMenuBarHostShell)
    let menuBarModuleLoaded = true
    #else
    let menuBarModuleLoaded = false
    #endif

    #if canImport(DextunnelUniversalIOSShell)
    let iosModuleLoaded = true
    #else
    let iosModuleLoaded = false
    #endif

    #if canImport(DextunnelNativeAppSupport)
    let nativeAppSupportLoaded = true
    #else
    let nativeAppSupportLoaded = false
    #endif

    #expect(menuBarModuleLoaded)
    #expect(nativeAppSupportLoaded)
    #expect(iosModuleLoaded)
}

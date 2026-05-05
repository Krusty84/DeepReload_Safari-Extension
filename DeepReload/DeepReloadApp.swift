//
//  DeepReloadApp.swift
//  DeepReload Host App
//  Boots the macOS container app and presents the extension onboarding window.
//
//  Created by Sedoykin Alexey on 30/04/2026.
//

import AppKit
import SwiftUI

@main
struct DeepReloadApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
        .commands {
            CommandGroup(replacing: .appSettings) {}
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var onboardingWindowController: OnboardingWindowController?
    private let actionController = ExtensionGuideActionController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        showOnboardingWindow()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            showOnboardingWindow()
        }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func showOnboardingWindow() {
        if onboardingWindowController == nil {
            onboardingWindowController = OnboardingWindowController(actionController: actionController)
        }

        onboardingWindowController?.showWindow(nil)
        onboardingWindowController?.window?.makeKeyAndOrderFront(nil)
    }
}

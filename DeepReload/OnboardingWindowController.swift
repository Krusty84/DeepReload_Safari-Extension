//
//  OnboardingWindowController.swift
//  DeepReload Host App
//  Creates the main container window and hosts the SwiftUI onboarding content.
//
//  Created by Sedoykin Alexey on 30/04/2026.
//

import AppKit
import SwiftUI

final class OnboardingWindowController: NSWindowController {
    init(actionController: ExtensionGuideActionController) {
        let contentView = ContentView(actionController: actionController)
        let hostingController = NSHostingController(rootView: contentView)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )

        window.center()
        window.title = "DeepReload"
        window.minSize = NSSize(width: 560, height: 620)
        window.maxSize = NSSize(width: 980, height: 860)
        window.titleVisibility = .visible
        window.toolbarStyle = .unified
        window.isReleasedWhenClosed = false
        window.contentViewController = hostingController

        super.init(window: window)
        shouldCascadeWindows = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }
}

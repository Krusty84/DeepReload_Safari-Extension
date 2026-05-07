//
//  ExtensionGuideActionController.swift
//  DeepReload
//  Handles Safari onboarding actions and publishes lightweight status feedback.
//
//  Created by Sedoykin Alexey on 30/04/2026.
//

import AppKit
import Combine
import SafariServices

@MainActor
final class ExtensionGuideActionController: ObservableObject {
    enum StatusTone {
        case neutral
        case success
        case error
    }


    let privacyPolicyURL = URL(string: "https://github.com/Krusty84/DeepReload-Safari-Extension-/blob/main/docs/index.html")!

    @Published var statusMessage: String?
    @Published var statusTone: StatusTone = .neutral
    @Published var isOpeningSettings = false

    func closeWindow() {
        NSApp.keyWindow?.close()
    }
}

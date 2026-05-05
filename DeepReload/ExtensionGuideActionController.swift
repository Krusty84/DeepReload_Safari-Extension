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

    private let extensionBundleIdentifier = "com.krusty84.DeepReload.Extension"
    let privacyPolicyURL = URL(string: "https://github.com/Krusty84/DeepReload-Safari-Extension-/blob/main/docs/index.html")!

    @Published var statusMessage: String?
    @Published var statusTone: StatusTone = .neutral
    @Published var isOpeningSettings = false

    func openSafariSettings() {
        guard !isOpeningSettings else { return }

        isOpeningSettings = true
        statusTone = .neutral
        statusMessage = "Opening Safari Settings…"

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }

                self.isOpeningSettings = false

                if let error {
                    self.statusTone = .error
                    self.statusMessage = "Couldn’t open Safari Settings: \(error.localizedDescription)"
                } else {
                    self.statusTone = .success
                    self.statusMessage = "Safari Settings opened. In Safari, enable DeepReload in the Extensions tab."
                }
            }
        }
    }

    func closeWindow() {
        NSApp.keyWindow?.close()
    }
}

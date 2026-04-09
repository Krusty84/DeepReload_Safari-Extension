//
//  AppDelegate.swift
//  DeepReload
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

import AppKit
import SafariServices

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: "com.krusty84.DeepReload.Extension") { error in
            if let error = error {
                print("Error opening extension settings: \(error.localizedDescription)")
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }
}

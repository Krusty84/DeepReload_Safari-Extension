//
//  ContentView.swift
//  DeepReload Host App
//  Renders the container app onboarding wizard for the Safari Web Extension.
//
//  Created by Sedoykin Alexey on 30/04/2026.
//

import AppKit
import SwiftUI

struct OnboardingPage: Identifiable {
    let id = UUID()
    let imageName: String
    let headline: String
    let details: String
}

extension OnboardingPage {
    // Add, remove, or reorder pages here. Image names must match PNG resources
    // included in the app bundle, without the ".png" extension.
    static let defaultPages = [
        OnboardingPage(
            imageName: "Icon",
            headline: "Welcome to Deep Reload",
            details: "Deep Reload adds Safari context-menu actions for refreshing a full page or a selected page element while bypassing stale cache."
        ),
        OnboardingPage(
            imageName: "DeepReloadSafariSettingsWindow",
            headline: "Enable the Safari extension",
            details: "Open Safari Settings, choose Extensions, then enable Deep Reload in the installed extensions list."
        ),
        OnboardingPage(
            imageName: "DeepReloadSettingsOverview",
            headline: "Review Deep Reload options",
            details: "Use the extension settings to choose whole-page reload, element reload, automatic refresh, and the visual indication style that fits your workflow."
        ),
        OnboardingPage(
            imageName: "DeepReloadContextMenu",
            headline: "Reload from the context menu",
            details: "Right-click in Safari and choose Deep Reload actions for the whole page, the element under the cursor, or automatic whole-page refresh."
        )
    ]
}

struct ContentView: View {
    @ObservedObject var actionController: ExtensionGuideActionController
    @State private var currentPageIndex = 0

    private let pages = OnboardingPage.defaultPages

    private var currentPage: OnboardingPage {
        pages[currentPageIndex]
    }

    private var isFirstPage: Bool {
        currentPageIndex == 0
    }

    private var isLastPage: Bool {
        currentPageIndex == pages.count - 1
    }

    var body: some View {
        VStack(spacing: 0) {
            pageContent
            bottomBar
        }
        .frame(minWidth: 560, minHeight: 620)
        .background(Color.white)
    }

    private var pageContent: some View {
        VStack(spacing: 28) {
            OnboardingImageView(imageName: currentPage.imageName)
                .frame(maxWidth: 760, maxHeight: 380)

            VStack(spacing: 12) {
                Text(currentPage.headline)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.black)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text(currentPage.details)
                    .font(.system(size: 16, weight: .regular, design: .rounded))
                    .foregroundStyle(Color.black.opacity(0.66))
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)

                if isLastPage, let statusMessage = actionController.statusMessage {
                    StatusMessageView(message: statusMessage, tone: actionController.statusTone)
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: 620)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 44)
        .padding(.top, 34)
        .padding(.bottom, 18)
    }

    private var bottomBar: some View {
        HStack(alignment: .center) {
            ProgressIndicator(currentStep: currentPageIndex + 1, totalSteps: pages.count)

            Spacer()

            HStack(spacing: 12) {
                if !isFirstPage {
                    Button(action: goBack) {
                        Image(systemName: "chevron.left")
                    }
                    .buttonStyle(IconNavigationButtonStyle(role: .secondary))
                    .help("Back")
                }

                if isLastPage {
                    Button(action: actionController.closeWindow) {
                        Text("I am ready!")
                    }
                    .buttonStyle(TextNavigationButtonStyle())
                } else {
                    Button(action: goForward) {
                        Image(systemName: "chevron.right")
                    }
                    .buttonStyle(IconNavigationButtonStyle(role: .primary))
                    .help("Forward")
                }
            }

        }
        .padding(.horizontal, 32)
        .padding(.vertical, 22)
        .background(Color.white)
    }

    private func goBack() {
        guard !isFirstPage else { return }
        currentPageIndex -= 1
    }

    private func goForward() {
        guard !isLastPage else { return }
        currentPageIndex += 1
    }
}

private struct OnboardingImageView: View {
    let imageName: String

    var body: some View {
        Group {
            if let image = loadImage() {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(image.size, contentMode: .fit)
            } else {
                MissingImageView(imageName: imageName)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func loadImage() -> NSImage? {
        if let namedImage = NSImage(named: NSImage.Name(imageName)) {
            return namedImage
        }

        let imageURL = Bundle.main.url(forResource: imageName, withExtension: "png")
            ?? Bundle.main.url(forResource: imageName, withExtension: "png", subdirectory: "Resources")

        guard let imageURL else {
            return nil
        }

        return NSImage(contentsOf: imageURL)
    }
}

private struct MissingImageView: View {
    let imageName: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "photo")
                .font(.system(size: 44, weight: .regular))
                .foregroundStyle(Color.gray)

            Text("Missing image: \(imageName).png")
                .font(.system(size: 14, weight: .medium, design: .rounded))
                .foregroundStyle(Color.gray)
        }
        .frame(maxWidth: .infinity, minHeight: 260)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.gray.opacity(0.08))
        )
    }
}

private struct ProgressIndicator: View {
    let currentStep: Int
    let totalSteps: Int

    var body: some View {
        HStack(spacing: 12) {
            Text("Step \(currentStep) of \(totalSteps)")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(Color.black.opacity(0.62))

            HStack(spacing: 6) {
                ForEach(1...totalSteps, id: \.self) { step in
                    Circle()
                        .fill(step == currentStep ? Color(nsColor: .systemGreen) : Color.black.opacity(0.16))
                        .frame(width: 7, height: 7)
                }
            }
            .accessibilityHidden(true)
        }
        .accessibilityLabel("Step \(currentStep) of \(totalSteps)")
    }
}

private struct StatusMessageView: View {
    let message: String
    let tone: ExtensionGuideActionController.StatusTone

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: iconName)
                .foregroundStyle(accentColor)

            Text(message)
                .font(.system(size: 13, weight: .regular, design: .rounded))
                .foregroundStyle(Color.black.opacity(0.72))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(accentColor.opacity(0.10))
        )
    }

    private var accentColor: Color {
        switch tone {
        case .neutral:
            return Color(nsColor: .systemBlue)
        case .success:
            return Color(nsColor: .systemGreen)
        case .error:
            return Color(nsColor: .systemRed)
        }
    }

    private var iconName: String {
        switch tone {
        case .neutral:
            return "info.circle.fill"
        case .success:
            return "checkmark.circle.fill"
        case .error:
            return "exclamationmark.triangle.fill"
        }
    }
}

private struct IconNavigationButtonStyle: ButtonStyle {
    enum Role {
        case primary
        case secondary
    }

    let role: Role

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .frame(width: 32, height: 32)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(backgroundColor(configuration: configuration))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(borderColor, lineWidth: 1)
            )
            .foregroundStyle(foregroundColor)
    }

    private var foregroundColor: Color {
        switch role {
        case .primary:
            return Color.white
        case .secondary:
            return Color.black.opacity(0.82)
        }
    }

    private var borderColor: Color {
        switch role {
        case .primary:
            return Color.clear
        case .secondary:
            return Color.black.opacity(0.18)
        }
    }

    private func backgroundColor(configuration: Configuration) -> Color {
        switch role {
        case .primary:
            return Color(nsColor: .systemGreen).opacity(configuration.isPressed ? 0.82 : 1)
        case .secondary:
            return Color.black.opacity(configuration.isPressed ? 0.08 : 0.02)
        }
    }
}

private struct TextNavigationButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .frame(minWidth: 108)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(nsColor: .systemGreen).opacity(configuration.isPressed ? 0.82 : 1))
            )
            .foregroundStyle(Color.white)
    }
}

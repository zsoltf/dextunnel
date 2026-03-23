#if os(iOS)
import SwiftUI
import DextunnelAppleState
import DextunnelBridgeProtocol
import DextunnelOperatorCore

@available(iOS 18.0, *)
public struct DextunnelUniversalOperatorView: View {
    private let compactTranscriptTopAnchor = "compactTranscriptTopAnchor"
    private let store: DextunnelLiveBridgeStore
    private let compactTranscriptBottomAnchor = "compactTranscriptBottomAnchor"
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @Binding private var appearanceRawValue: String
    @AppStorage("universal_ios_filters_visible") private var compactFiltersVisible = false
    @AppStorage("universal_ios_transcript_text_size") private var transcriptTextSizeRawValue = CompactTranscriptTextSize.extraSmall.rawValue
    @State private var interactionAnswers: [String: String] = [:]
    @State private var isChannelSheetPresented = false
    @State private var isQueueSheetPresented = false
    @State private var pendingChannelSelectionId: String?
    @State private var channelSelectionPulse = false
    @State private var hasSettledInitialCompactScroll = false
    @State private var compactTranscriptBottomMarkerY: CGFloat = 0
    @State private var compactTranscriptContentHeight: CGFloat = 0
    @State private var compactTranscriptViewportHeight: CGFloat = 0
    @State private var transcriptFilters: Set<DextunnelTranscriptFilter> = Set(DextunnelTranscriptFilter.allCases)
    @State private var dictationController: DextunnelNativeDictationController

    public init(store: DextunnelLiveBridgeStore, appearanceRawValue: Binding<String>) {
        self.store = store
        self._appearanceRawValue = appearanceRawValue
        _dictationController = State(initialValue: DextunnelNativeDictationController(store: store))
    }

    public var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                regularLayout
            } else {
                compactLayout
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase != .active && store.isDictating {
                dictationController.stop()
            }
        }
        .onChange(of: pendingChannelSelectionId) { _, nextValue in
            if nextValue == nil {
                channelSelectionPulse = false
                return
            }

            channelSelectionPulse = false
            withAnimation(.easeInOut(duration: 0.72).repeatForever(autoreverses: true)) {
                channelSelectionPulse = true
            }
        }
        .onChange(of: store.selectedThreadId) { _, _ in
            settlePendingChannelSelectionIfNeeded()
        }
        .onChange(of: store.isSelecting) { _, _ in
            settlePendingChannelSelectionIfNeeded()
        }
        .onChange(of: store.lastErrorMessage) { _, nextValue in
            guard pendingChannelSelectionId != nil else {
                return
            }

            let hasVisibleError = !(nextValue?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            if hasVisibleError && !store.isSelecting {
                pendingChannelSelectionId = nil
            }
        }
        .onChange(of: isChannelSheetPresented) { _, isPresented in
            if !isPresented {
                pendingChannelSelectionId = nil
            }
        }
    }

    private var compactLayout: some View {
        ZStack(alignment: .top) {
            compactBackground
                .ignoresSafeArea()

            ScrollViewReader { proxy in
                VStack(spacing: 0) {
                    compactTopChrome

                    GeometryReader { scrollGeometry in
                        ScrollView {
                            Color.clear
                                .frame(height: 1)
                                .id(compactTranscriptTopAnchor)

                            compactContent
                                .background(
                                    GeometryReader { contentGeometry in
                                        Color.clear.preference(
                                            key: CompactTranscriptContentHeightPreferenceKey.self,
                                            value: contentGeometry.size.height
                                        )
                                    }
                                )
                                .padding(.top, 6)
                                .padding(.bottom, compactTranscriptBottomInset)
                            Color.clear
                                .frame(height: 1)
                                .background(
                                    GeometryReader { markerGeometry in
                                        Color.clear.preference(
                                            key: CompactTranscriptBottomMarkerPreferenceKey.self,
                                            value: markerGeometry.frame(in: .named("compactTranscriptScroll")).minY
                                        )
                                    }
                                )
                                .id(compactTranscriptBottomAnchor)
                        }
                        .coordinateSpace(name: "compactTranscriptScroll")
                        .onAppear {
                            compactTranscriptViewportHeight = scrollGeometry.size.height
                        }
                        .onChange(of: compactTranscriptEntryIDs) { _, _ in
                            if !hasSettledInitialCompactScroll && !compactVisibleTranscriptEntries.isEmpty {
                                hasSettledInitialCompactScroll = true
                                scrollCompactTranscriptToLatest(using: proxy, animated: false)
                            } else if compactShouldAutoScrollToLatest {
                                scrollCompactTranscriptToPreferredPosition(using: proxy, animated: false)
                            }
                        }
                        .onChange(of: compactTranscriptChangeIDs) { _, _ in
                            if !hasSettledInitialCompactScroll && transcriptHasChangeSection {
                                hasSettledInitialCompactScroll = true
                                scrollCompactTranscriptToLatest(using: proxy, animated: false)
                            } else if compactShouldAutoScrollToLatest {
                                scrollCompactTranscriptToPreferredPosition(using: proxy, animated: false)
                            }
                        }
                        .onChange(of: transcriptFilterSignature) { _, _ in
                            hasSettledInitialCompactScroll = false
                            scrollCompactTranscriptToPreferredPosition(using: proxy, animated: true)
                        }
                        .onChange(of: compactFiltersVisible) { _, _ in
                            scrollCompactTranscriptToPreferredPosition(using: proxy, animated: true)
                        }
                        .onChange(of: store.selectedThreadId) { _, _ in
                            hasSettledInitialCompactScroll = false
                            scrollCompactTranscriptToPreferredPosition(using: proxy, animated: false)
                        }
                        .onChange(of: scrollGeometry.size.height) { _, nextHeight in
                            compactTranscriptViewportHeight = nextHeight
                        }
                        .onPreferenceChange(CompactTranscriptBottomMarkerPreferenceKey.self) { nextValue in
                            compactTranscriptBottomMarkerY = nextValue
                            compactTranscriptViewportHeight = scrollGeometry.size.height
                        }
                        .onPreferenceChange(CompactTranscriptContentHeightPreferenceKey.self) { nextValue in
                            compactTranscriptContentHeight = nextValue
                            guard nextValue > 0 else {
                                return
                            }
                            if !hasSettledInitialCompactScroll &&
                                (!compactVisibleTranscriptEntries.isEmpty || transcriptHasChangeSection) {
                                hasSettledInitialCompactScroll = true
                                scrollCompactTranscriptToLatest(using: proxy, animated: false)
                            }
                        }
                        .scrollDismissesKeyboard(.interactively)
                        .refreshable {
                            await store.refresh()
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .overlay(alignment: .bottom) {
                    if compactShowsScrollToLatestButton {
                        HStack {
                            Spacer(minLength: 0)
                            compactScrollToLatestButton(proxy: proxy)
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, compactTranscriptBottomInset + 4)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .animation(.easeInOut(duration: 0.22), value: compactFiltersVisible)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            compactComposerInset
        }
        .sheet(isPresented: $isChannelSheetPresented) {
            compactChannelSheet
        }
        .sheet(isPresented: $isQueueSheetPresented) {
            compactQueueSheet
        }
    }

    private var compactBackground: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.97, blue: 1.0),
                    Color(red: 0.98, green: 0.99, blue: 1.0)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            LinearGradient(
                colors: [
                    Color.accentColor.opacity(colorScheme == .dark ? 0.18 : 0.1),
                    Color.clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            RadialGradient(
                colors: [
                    Color.white.opacity(colorScheme == .dark ? 0.12 : 0.16),
                    Color.clear
                ],
                center: .top,
                startRadius: 24,
                endRadius: 420
            )

            if colorScheme == .dark {
                Color.black.opacity(0.04)
            }
        }
    }

    private var compactTranscriptBottomInset: CGFloat {
        compactAccessoryTrayVisible || compactComposerFooterVisible ? 108 : 76
    }

    @ViewBuilder
    private var compactContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let pending = store.livePayload?.pendingInteraction {
                pendingInteractionCard(pending)
                    .padding(.horizontal, 8)
            }

            compactTranscriptSection
        }
    }

    private var compactTopChrome: some View {
        VStack(alignment: .leading, spacing: 0) {
            compactTopBar
                .padding(.horizontal, 10)
                .padding(.top, compactFiltersVisible ? 0 : 0)
                .padding(.bottom, compactFiltersVisible ? 5 : 6)

            if let topNotice = compactTopNoticeText, !topNotice.isEmpty {
                compactTopNoticeBanner(topNotice, tone: compactTopNoticeTone)
                    .padding(.horizontal, 10)
                    .padding(.bottom, compactFiltersVisible ? 4 : 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            if compactFiltersVisible {
                compactTranscriptFilterBar
                    .padding(.bottom, 5)
                    .transition(
                        .asymmetric(
                            insertion: .move(edge: .top).combined(with: .opacity),
                            removal: .move(edge: .top).combined(with: .opacity)
                        )
                    )
            }

            Divider()
        }
        .animation(.easeInOut(duration: 0.2), value: compactFiltersVisible)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .dextunnelGlassChrome(cornerRadius: 0, shadowOpacity: 0.05)
        .zIndex(1)
    }

    private var compactTopBar: some View {
        HStack(alignment: .center, spacing: 8) {
            Text(store.currentRoomTitle)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxHeight: .infinity, alignment: .center)

            Spacer(minLength: 6)

            Button {
                Task {
                    if store.connectionPhase != .live || store.livePayload?.status.watcherConnected == false {
                        await store.reconnect()
                    } else {
                        await store.refresh()
                    }
                }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 20, height: 20)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)
            .disabled(store.isRefreshing)
            .accessibilityLabel(store.connectionPhase != .live || store.livePayload?.status.watcherConnected == false ? "Reconnect" : "Refresh")

            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    compactFiltersVisible.toggle()
                }
            } label: {
                Image(systemName: compactFiltersVisible ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 20, height: 20)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)
            .accessibilityLabel(compactFiltersVisible ? "Hide filters" : "Show filters")

            displaySettingsMenu

            Button {
                isChannelSheetPresented = true
            } label: {
                Image(systemName: "sidebar.leading")
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 20, height: 20)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)
            .disabled(store.isSelecting || store.isSending)
            .accessibilityLabel("Show channels")
        }
        .frame(height: compactFiltersVisible ? 24 : 24, alignment: .center)
        .offset(y: compactFiltersVisible ? -7 : -7)
    }

    private var compactShowsScrollToLatestButton: Bool {
        compactTranscriptBottomMarkerY > compactTranscriptViewportHeight + 28
    }

    private var compactShouldAutoScrollToLatest: Bool {
        !compactShowsScrollToLatestButton
    }

    private func compactScrollToLatestButton(proxy: ScrollViewProxy) -> some View {
        Button {
            scrollCompactTranscriptToLatest(using: proxy, animated: true)
        } label: {
            Image(systemName: "arrow.down")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 34, height: 34)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(
                    Circle()
                        .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.16 : 0.38), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.12), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Jump to latest")
    }

    private var displaySettingsMenu: some View {
        Menu {
            Section("Text size") {
                Picker("Text size", selection: $transcriptTextSizeRawValue) {
                    ForEach(CompactTranscriptTextSize.allCases) { size in
                        Text(size.title).tag(size.rawValue)
                    }
                }
            }

            Section("Appearance") {
                Picker("Appearance", selection: $appearanceRawValue) {
                    ForEach(DextunnelAppearancePreference.allCases) { preference in
                        Text(preference.title).tag(preference.rawValue)
                    }
                }
            }
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 20, height: 20)
        }
        .foregroundStyle(Color.accentColor)
        .accessibilityLabel("Display settings")
    }

    private var regularLayout: some View {
        NavigationSplitView {
            threadListView()
                .navigationTitle("Rooms")
        } detail: {
            HStack(spacing: 0) {
                transcriptPanel
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                ScrollView {
                    operatorCards(includeTranscript: false)
                        .padding()
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable {
                    await store.refresh()
                }
                .frame(minWidth: 320, idealWidth: 360, maxWidth: 420, maxHeight: .infinity)
            }
            .navigationTitle(store.currentRoomTitle)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if let busy = busyStatusLine {
                        HStack(spacing: 6) {
                            ProgressView()
                                .controlSize(.small)
                            Text(busy)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button("Refresh") {
                        Task { await store.refresh() }
                    }
                    .disabled(store.isRefreshing)

                    displaySettingsMenu

                    Button("Reveal") {
                        Task { await store.revealSelectedThreadInCodex() }
                    }
                    .disabled(store.selectedThreadId.isEmpty)
                }
            }
        }
    }

    private func threadListView() -> some View {
        let threads = store.threads

        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                ForEach(threads, id: \DextunnelThreadSummary.id) { (thread: DextunnelThreadSummary) in
                    let isPendingSelection = pendingChannelSelectionId == thread.id
                    let isCurrentSelection = thread.id == store.selectedThreadId
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(threadListTitle(for: thread))
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(2)
                                .minimumScaleFactor(0.8)
                            Spacer()
                            if let updatedAt = threadListUpdatedAtText(thread.updatedAt) {
                                Text(updatedAt)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            threadRowStatusIndicator(
                                isPendingSelection: isPendingSelection,
                                isCurrentSelection: isCurrentSelection
                            )
                        }
                        if let preview = threadListPreviewText(for: thread) {
                            Text(preview)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(
                        isPendingSelection
                            ? Color.accentColor.opacity(colorScheme == .dark ? 0.14 : 0.1)
                            : Color(uiColor: .secondarySystemBackground),
                        in: RoundedRectangle(cornerRadius: 12)
                    )
                    .contentShape(Rectangle())
                    .onTapGesture {
                        guard !store.isSelecting, !store.isSending else {
                            return
                        }
                        if isCurrentSelection {
                            withAnimation(.easeInOut(duration: 0.16)) {
                                isChannelSheetPresented = false
                            }
                            return
                        }

                        pendingChannelSelectionId = thread.id
                        Task {
                            await store.select(thread: thread)
                        }
                    }
                    .opacity(isPendingSelection ? (channelSelectionPulse ? 0.78 : 1) : 1)
                }
            }
            .padding()
        }
        .refreshable {
            await store.refresh()
        }
    }

    private var compactChannelSheet: some View {
        NavigationStack {
            threadListView()
            .navigationTitle("Channels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        isChannelSheetPresented = false
                    }
                }
            }
        }
    }

    private var compactQueueSheet: some View {
        NavigationStack {
            ScrollView {
                queueSection
                    .padding()
            }
            .navigationTitle("Queue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        isQueueSheetPresented = false
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func operatorCards(includeTranscript: Bool, includeComposer: Bool = true) -> some View {
        if includeTranscript {
            compactTranscriptSection
        }
        roomStatusCard(availability: store.availability, lease: store.livePayload?.status.controlLeaseForSelection)

        if changesSectionVisible {
            changesSection
        }

        if let pending = store.livePayload?.pendingInteraction {
            pendingInteractionCard(pending)
        }

        if includeComposer {
            draftComposerCard
        }

        if !store.queuedDrafts.isEmpty {
            queueSection
        }
    }

    private var compactComposerInset: some View {
        VStack(spacing: 2) {
            if compactAccessoryTrayVisible {
                compactAccessoryTray
            }
            compactComposerBar
            if compactComposerFooterVisible {
                compactComposerFooter
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity, alignment: .bottom)
        .background(compactComposerBackdrop)
        .shadow(color: Color.black.opacity(0.08), radius: 14, y: -2)
    }

    private var compactComposerBackdrop: some View {
        ZStack(alignment: .top) {
            Rectangle()
                .fill(.regularMaterial)
            Rectangle()
                .fill(Color(uiColor: .systemBackground).opacity(colorScheme == .dark ? 0.78 : 0.72))
            Rectangle()
                .fill(Color.white.opacity(colorScheme == .dark ? 0.08 : 0.32))
                .frame(height: 1)
        }
        .overlay(alignment: .bottom) {
            ZStack {
                Rectangle()
                    .fill(.regularMaterial)
                Rectangle()
                    .fill(Color(uiColor: .systemBackground).opacity(colorScheme == .dark ? 0.82 : 0.76))
            }
            .frame(height: 24)
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private var draftComposerCard: some View {
        @Bindable var store = store
        let availability = store.availability

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Draft")
                    .font(.headline)
                Spacer()
                if store.isDictating {
                    HStack(spacing: 8) {
                        DextunnelDictationActivityView()
                        Text(dictationController.statusText)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                } else {
                    Text(dictationController.statusText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }

                Button {
                    Task { await dictationController.toggle() }
                } label: {
                    Image(systemName: store.isDictating ? "stop.circle.fill" : "mic.circle")
                        .font(.title3)
                }
                .buttonStyle(.bordered)
                .disabled(store.isSending || store.isSelecting)
                .accessibilityLabel(store.isDictating ? "Stop dictation" : dictationController.buttonTitle)
            }

            TextEditor(text: $store.draftText)
                .frame(minHeight: 140)
                .padding(8)
                .background(Color.white.opacity(colorScheme == .dark ? 0.08 : 0.55), in: RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.14 : 0.45), lineWidth: 1)
                )
                .scrollContentBackground(.hidden)

            compactComposerActions(availability: availability)

            if !availability.statusMessage.isEmpty {
                Text(availability.statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let dictationError = dictationController.lastErrorMessage, !dictationError.isEmpty {
                Text(dictationError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            if let lastRevealMessage = store.lastRevealMessage, !lastRevealMessage.isEmpty {
                Text(lastRevealMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let lastErrorMessage = store.lastErrorMessage, !lastErrorMessage.isEmpty {
                Text(lastErrorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .dextunnelGlassCard()
        .onDisappear {
            if store.isDictating {
                dictationController.stop()
            }
        }
    }

    private var compactComposerBar: some View {
        @Bindable var store = store
        let trimmedDraft = store.draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasDraftText = !trimmedDraft.isEmpty
        let hasQueuedDrafts = !store.queuedDrafts.isEmpty

        return HStack(alignment: .center, spacing: 5) {
            Button {
                Task { await dictationController.toggle() }
            } label: {
                Image(systemName: store.isDictating ? "stop.circle.fill" : "waveform.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .background(Color.white.opacity(colorScheme == .dark ? 0.1 : 0.58), in: Circle())
                    .overlay(
                        Circle()
                            .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.15 : 0.42), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .foregroundStyle(store.isDictating ? Color.red : Color.accentColor)
            .disabled(store.isSending || store.isSelecting)
            .accessibilityLabel(store.isDictating ? "Stop dictation" : dictationController.buttonTitle)

            TextField("Message Dextunnel", text: $store.draftText, axis: .vertical)
                .lineLimit(1...2)
                .font(.subheadline)
                .textFieldStyle(.plain)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(colorScheme == .dark ? 0.08 : 0.64), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                        .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.15 : 0.46), lineWidth: 1)
                )

            if hasDraftText || hasQueuedDrafts {
                Button {
                    if hasDraftText {
                        store.queueCurrentDraft()
                    } else if hasQueuedDrafts {
                        isQueueSheetPresented = true
                    }
                } label: {
                    Image(systemName: hasQueuedDrafts ? "clock.fill" : "clock")
                        .font(.system(size: 11, weight: .semibold))
                        .frame(width: 28, height: 28)
                        .background(Color.white.opacity(colorScheme == .dark ? 0.08 : 0.56), in: Circle())
                        .overlay(
                            Circle()
                                .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.15 : 0.4), lineWidth: 1)
                        )
                        .foregroundStyle(
                            hasDraftText
                                ? (store.availability.canQueue ? Color.accentColor : Color.secondary.opacity(0.6))
                                : Color.accentColor
                        )
                }
                .buttonStyle(.plain)
                .disabled(hasDraftText ? !store.availability.canQueue : !hasQueuedDrafts)
                .accessibilityLabel(hasDraftText ? "Queue" : "Show queue")
            }

            Button {
                Task { await store.sendCurrentDraft() }
            } label: {
                Group {
                    if store.isSending {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: 28, height: 28)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .semibold))
                            .frame(width: 28, height: 28)
                    }
                }
                .background(
                    Circle()
                        .fill(store.availability.canSteer ? Color.accentColor : Color(uiColor: .secondarySystemBackground))
                )
                .overlay(
                    Circle()
                        .strokeBorder(
                            store.availability.canSteer
                                ? Color.white.opacity(0.24)
                                : Color.white.opacity(colorScheme == .dark ? 0.12 : 0.34),
                            lineWidth: 1
                        )
                )
                .foregroundStyle(store.availability.canSteer ? Color.white : Color.secondary.opacity(0.7))
            }
            .buttonStyle(.plain)
            .disabled(!store.availability.canSteer)
            .accessibilityLabel("Steer now")
        }
    }

    private var compactAccessoryTrayVisible: Bool {
        compactControlActionVisible || !compactPrimaryStatusText.isEmpty || store.queuedDrafts.count > 0 || store.isDictating
    }

    private var compactAccessoryTray: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if !compactPrimaryStatusText.isEmpty {
                    compactInfoChip(compactPrimaryStatusText, tone: .secondary)
                }

                if store.queuedDrafts.count > 0 {
                    Button {
                        isQueueSheetPresented = true
                    } label: {
                        compactInfoChip(DextunnelOperatorCore.queueSummary(store.queuedDrafts.count), tone: .accent)
                    }
                    .buttonStyle(.plain)
                }

                if store.isDictating {
                    HStack(spacing: 6) {
                        DextunnelDictationActivityView()
                        Text("Listening...")
                            .lineLimit(1)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                if compactControlActionVisible {
                    Button(compactControlActionTitle) {
                        Task {
                            if store.holdsControlLease {
                                await store.releaseControl()
                            } else {
                                await store.claimControl()
                            }
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
    }

    private var compactPrimaryStatusText: String {
        if store.isSending {
            return ""
        }
        if let busy = busyStatusLine, !busy.isEmpty {
            return busy
        }
        let status = store.availability.statusMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        if status == "Ready" ||
            status == "Take control to send from remote." ||
            status == "Steer now will take control. Queue stays local until you steer." {
            return ""
        }
        if status == "Live watcher offline." {
            return "Bridge offline"
        }
        if status == "Resolve the pending action first." {
            return "Finish pending action first"
        }
        if status.contains("currently has control.") {
            return "Control held elsewhere"
        }
        if status.hasPrefix("Codex is busy.") {
            return "Busy"
        }
        return status
    }

    @ViewBuilder
    private var compactComposerFooter: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let dictationError = dictationController.lastErrorMessage, !dictationError.isEmpty {
                Text(dictationError)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            } else if let lastRevealMessage = store.lastRevealMessage, !lastRevealMessage.isEmpty {
                Text(lastRevealMessage)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var compactComposerFooterVisible: Bool {
        if let dictationError = dictationController.lastErrorMessage, !dictationError.isEmpty {
            return true
        }
        if let lastRevealMessage = store.lastRevealMessage, !lastRevealMessage.isEmpty {
            return true
        }
        return false
    }

    private var compactTopNoticeText: String? {
        let message = store.lastErrorMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !message.isEmpty {
            return message
        }

        let connectionMessage = store.connectionNoticeText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return connectionMessage.isEmpty ? nil : connectionMessage
    }

    private var compactTopNoticeTone: CompactInfoTone {
        let message = store.lastErrorMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return message.isEmpty ? .secondary : .warning
    }

    private var compactTopNoticeSymbolName: String {
        compactTopNoticeTone == .warning ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath"
    }

    private func compactTopNoticeBanner(_ text: String, tone: CompactInfoTone) -> some View {
        HStack(spacing: 8) {
            Image(systemName: compactTopNoticeSymbolName)
                .font(.caption.weight(.semibold))
            Text(text)
                .font(.caption)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(tone.background.opacity(colorScheme == .dark ? 0.9 : 0.78), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.12 : 0.32), lineWidth: 1)
        )
    }

    private var compactControlActionVisible: Bool {
        if store.isSending || store.isSelecting || store.isDictating {
            return false
        }
        return store.controlLeaseForSelection != nil
    }

    private var compactControlActionTitle: String {
        store.holdsControlLease ? "Release" : "Claim"
    }

    private func compactInfoChip(_ text: String, tone: CompactInfoTone) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(tone.foreground)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(tone.background.opacity(colorScheme == .dark ? 0.9 : 0.74), in: Capsule(style: .continuous))
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.12 : 0.38), lineWidth: 1)
            )
            .lineLimit(1)
    }

    @ViewBuilder
    private func compactComposerActions(availability: DextunnelOperatorAvailability) -> some View {
        if horizontalSizeClass == .regular {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    composerControlButton
                    Spacer(minLength: 0)
                    composerQueueButton(availability: availability)
                    composerSteerButton(availability: availability)
                }

                compactComposerStackedActions(availability: availability)
            }
        } else {
            compactComposerStackedActions(availability: availability)
        }
    }

    private func compactComposerStackedActions(availability: DextunnelOperatorAvailability) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            composerControlButton
                .frame(maxWidth: .infinity)

            HStack(spacing: 10) {
                composerQueueButton(availability: availability)
                    .frame(maxWidth: .infinity)
                composerSteerButton(availability: availability)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var composerControlButton: some View {
        Button(store.livePayload?.status.controlLeaseForSelection == nil ? "Claim control" : "Release control") {
            Task {
                if store.livePayload?.status.controlLeaseForSelection == nil {
                    await store.claimControl()
                } else {
                    await store.releaseControl()
                }
            }
        }
        .buttonStyle(.bordered)
        .disabled(store.isSending || store.isSelecting)
        .lineLimit(2)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func composerQueueButton(availability: DextunnelOperatorAvailability) -> some View {
        Button("Queue") {
            store.queueCurrentDraft()
        }
        .buttonStyle(.bordered)
        .disabled(!availability.canQueue)
        .lineLimit(2)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func composerSteerButton(availability: DextunnelOperatorAvailability) -> some View {
        Button("Steer now") {
            Task { await store.sendCurrentDraft() }
        }
        .buttonStyle(.borderedProminent)
        .disabled(!availability.canSteer)
        .lineLimit(2)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func roomStatusCard(
        availability: DextunnelOperatorAvailability,
        lease: DextunnelControlLease?
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.menuBarOverview?.statusSummary ?? "Bridge idle")
                .font(.headline)

            if let subtitle = store.menuBarOverview?.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(DextunnelOperatorCore.desktopSyncNote())
                .font(.caption2)
                .foregroundStyle(.secondary)

            if let lease {
                Label("Control held by \(lease.owner ?? lease.source ?? "another surface")", systemImage: "lock.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            if let busy = busyStatusLine {
                Label(busy, systemImage: "hourglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !(store.menuBarOverview?.diagnostics.isEmpty ?? true) {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(store.menuBarOverview?.diagnostics ?? [], id: \.self) { line in
                        Text(line)
                            .font(.caption)
                    }
                }
                .padding(10)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }

            if !availability.statusMessage.isEmpty {
                Text(availability.statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .dextunnelGlassCard()
    }

    private func pendingInteractionCard(_ pending: DextunnelPendingInteraction) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(pending.title ?? pending.summary ?? "Pending action")
                .font(.headline)

            if let flowLabel = pending.flowLabel, !flowLabel.isEmpty {
                Text(flowLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let flowContinuation = pending.flowContinuation, !flowContinuation.isEmpty {
                Text(flowContinuation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let detail = pending.detail, !detail.isEmpty {
                Text(detail)
                    .font(.body)
            }

            if let questions = pending.questions, !questions.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(questions) { question in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(question.header ?? question.question ?? question.id)
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            if let options = question.options, !options.isEmpty {
                                Picker(
                                    question.header ?? question.question ?? question.id,
                                    selection: Binding(
                                        get: { interactionAnswers[question.id] ?? "" },
                                        set: { interactionAnswers[question.id] = $0 }
                                    )
                                ) {
                                    Text("Select").tag("")
                                    ForEach(options) { option in
                                        Text(option.label).tag(option.label)
                                    }
                                }
                                .pickerStyle(.menu)
                            } else {
                                TextField(
                                    question.header ?? question.question ?? question.id,
                                    text: Binding(
                                        get: { interactionAnswers[question.id] ?? "" },
                                        set: { interactionAnswers[question.id] = $0 }
                                    )
                                )
                                .textFieldStyle(.roundedBorder)
                            }
                        }
                    }
                }
            }

            if pending.actionKind == "user_input" {
                if horizontalSizeClass == .regular {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) {
                            Button("Cancel") {
                                Task { await store.respondToPendingInteraction(action: "cancel") }
                            }
                            Spacer(minLength: 0)
                            Button(pending.submitLabel ?? "Submit") {
                                Task {
                                    await store.respondToPendingInteraction(
                                        action: "submit",
                                        answers: interactionAnswers.filter { !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                                    )
                                    interactionAnswers = [:]
                                }
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        compactUserInputActions(pending: pending)
                    }
                } else {
                    compactUserInputActions(pending: pending)
                }
            } else {
                if horizontalSizeClass == .regular {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) {
                            Button(pending.declineLabel ?? "Decline") {
                                Task { await store.respondToPendingInteraction(action: "decline") }
                            }
                            Spacer(minLength: 0)

                            if pending.canApproveForSession == true {
                                Button(pending.sessionActionLabel ?? "Allow session") {
                                    Task { await store.respondToPendingInteraction(action: "session") }
                                }
                            }

                            Button(pending.approveLabel ?? "Approve") {
                                Task { await store.respondToPendingInteraction(action: "approve") }
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        compactDecisionActions(pending: pending)
                    }
                } else {
                    compactDecisionActions(pending: pending)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .dextunnelGlassCard()
    }

    private var queueSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if horizontalSizeClass == .regular {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        Text("Queue")
                            .font(.headline)
                        Spacer(minLength: 0)
                        if !store.queuedDrafts.isEmpty {
                            Button("Clear") {
                                store.clearQueuedDrafts()
                            }
                            .font(.caption)
                        }
                        Button("Flush next") {
                            Task { await store.flushFirstQueuedDraft() }
                        }
                        .disabled(store.queuedDrafts.isEmpty || store.isSending)
                    }

                    compactQueueHeaderActions
                }
            } else {
                compactQueueHeaderActions
            }
 
            ForEach(store.queuedDrafts) { draft in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 8) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(draft.text)
                                .lineLimit(3)
                            queueDeliveryStatusLabel(for: draft)
                            Text(draft.id.uuidString)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if let lastErrorMessage = draft.lastErrorMessage, !lastErrorMessage.isEmpty {
                                Text(lastErrorMessage)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer(minLength: 8)

                        if draft.deliveryState == .failed {
                            Button("Retry") {
                                Task { await store.retryQueuedDraft(id: draft.id) }
                            }
                            .font(.caption)
                            .buttonStyle(.borderless)
                        } else {
                            Button {
                                store.removeQueuedDraft(id: draft.id)
                            } label: {
                                Image(systemName: "trash")
                                    .font(.caption)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Remove queued draft")
                            .disabled(draft.deliveryState == .sending)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }

            if !store.recentDeliveredDrafts.isEmpty {
                Divider()

                HStack {
                    Text("Recent sent")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Clear sent") {
                        store.clearRecentDeliveredDrafts()
                    }
                    .font(.caption)
                }

                ForEach(store.recentDeliveredDrafts) { draft in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(draft.text)
                            .lineLimit(2)
                        queueDeliveryStatusLabel(for: draft)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .dextunnelGlassCard()
    }

    private func compactUserInputActions(pending: DextunnelPendingInteraction) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(pending.submitLabel ?? "Submit") {
                Task {
                    await store.respondToPendingInteraction(
                        action: "submit",
                        answers: interactionAnswers.filter { !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    )
                    interactionAnswers = [:]
                }
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)

            Button("Cancel") {
                Task { await store.respondToPendingInteraction(action: "cancel") }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func compactDecisionActions(pending: DextunnelPendingInteraction) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(pending.approveLabel ?? "Approve") {
                Task { await store.respondToPendingInteraction(action: "approve") }
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)

            if pending.canApproveForSession == true {
                Button(pending.sessionActionLabel ?? "Allow session") {
                    Task { await store.respondToPendingInteraction(action: "session") }
                }
                .frame(maxWidth: .infinity)
            }

            Button(pending.declineLabel ?? "Decline") {
                Task { await store.respondToPendingInteraction(action: "decline") }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var compactQueueHeaderActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Queue")
                .font(.headline)

            HStack(spacing: 10) {
                if !store.queuedDrafts.isEmpty {
                    Button("Clear") {
                        store.clearQueuedDrafts()
                    }
                    .font(.caption)
                }

                Button("Flush next") {
                    Task { await store.flushFirstQueuedDraft() }
                }
                .disabled(store.queuedDrafts.isEmpty || store.isSending)
            }
        }
    }

    private var changesSectionVisible: Bool {
        transcriptFilters.contains(.changes) && !(store.livePayload?.turnDiff?.items.isEmpty ?? true)
    }

    private var changesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Changes")
                    .font(.headline)
                Spacer()
                Text("\(store.livePayload?.turnDiff?.items.count ?? 0)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(store.livePayload?.turnDiff?.items ?? [], id: \.id) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.path)
                        .font(.body.monospaced())
                        .lineLimit(2)

                    let meta = changeMetaLabel(for: item)
                    if !meta.isEmpty {
                        Text(meta)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
    }

    private var compactTranscriptSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if transcriptHasChangeSection {
                changesListContent
            }

            if compactVisibleTranscriptEntries.isEmpty {
                if !transcriptHasChangeSection {
                    transcriptPlaceholder
                }
            } else {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(compactVisibleTranscriptEntries, id: \.id) { entry in
                        compactTranscriptEntryRow(entry)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.easeInOut(duration: 0.22), value: compactFiltersVisible)
    }

    private var transcriptPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                transcriptHeader
                if transcriptHasChangeSection {
                    changesListContent
                }

                if fullTranscriptEntries.isEmpty {
                    if !transcriptHasChangeSection {
                        transcriptPlaceholder
                    }
                } else {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(fullTranscriptEntries, id: \.id) { entry in
                            transcriptEntryCard(entry)
                        }
                    }
                }
            }
            .padding()
        }
        .refreshable {
            await store.refresh()
        }
    }

    private var transcriptHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Transcript")
                    .font(.headline)
            }

            if let topic = store.livePayload?.selectedChannel?.topic, !topic.isEmpty {
                Text(topic)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            transcriptFilterBar
        }
    }

    private var transcriptPlaceholder: some View {
        Text(transcriptPlaceholderText)
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 320, alignment: .center)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
    }

    private var compactTranscriptHeader: some View {
        compactTranscriptFilterBar
            .padding(.top, 2)
    }

    private var compactVisibleTranscriptEntries: [DextunnelTranscriptEntry] {
        fullTranscriptEntries
    }

    private var compactTranscriptEntryIDs: [String] {
        compactVisibleTranscriptEntries.map(\.id)
    }

    private var compactTranscriptChangeIDs: [String] {
        transcriptHasChangeSection ? changeItems.map(\.id) : []
    }

    private var transcriptFilterSignature: String {
        transcriptFilters.map(\.rawValue).sorted().joined(separator: ",")
    }

    private var transcriptHasChangeSection: Bool {
        transcriptFilters.contains(.changes) && !changeItems.isEmpty
    }

    private var fullTranscriptEntries: [DextunnelTranscriptEntry] {
        DextunnelOperatorCore.transcriptEntries(from: allTranscriptEntries, filters: transcriptFilters)
    }

    private var allTranscriptEntries: [DextunnelTranscriptEntry] {
        store.livePayload?.selectedThreadSnapshot?.transcript ?? []
    }

    private var changeItems: [DextunnelTurnDiffItem] {
        store.livePayload?.turnDiff?.items ?? []
    }

    private var transcriptFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(DextunnelTranscriptFilter.allCases) { filter in
                    Button {
                        toggleTranscriptFilter(filter)
                    } label: {
                        Text(filter.title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(transcriptFilters.contains(filter) ? Color.white : Color.primary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(
                                transcriptFilters.contains(filter)
                                    ? Color.accentColor
                                    : Color.white.opacity(colorScheme == .dark ? 0.08 : 0.56),
                                in: Capsule(style: .continuous)
                            )
                            .overlay(
                                Capsule(style: .continuous)
                                    .strokeBorder(
                                        transcriptFilters.contains(filter)
                                            ? Color.white.opacity(0.22)
                                            : Color.white.opacity(colorScheme == .dark ? 0.12 : 0.38),
                                        lineWidth: 1
                                    )
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var compactTranscriptFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(DextunnelTranscriptFilter.allCases) { filter in
                    Button {
                        toggleTranscriptFilter(filter)
                    } label: {
                        Text(filter.title)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(transcriptFilters.contains(filter) ? Color.white : Color.primary)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(
                                transcriptFilters.contains(filter)
                                    ? Color.accentColor
                                    : Color.white.opacity(colorScheme == .dark ? 0.08 : 0.56),
                                in: Capsule(style: .continuous)
                            )
                            .overlay(
                                Capsule(style: .continuous)
                                    .strokeBorder(
                                        transcriptFilters.contains(filter)
                                            ? Color.white.opacity(0.22)
                                            : Color.white.opacity(colorScheme == .dark ? 0.12 : 0.38),
                                        lineWidth: 1
                                    )
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var changesListContent: some View {
        LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(changeItems, id: \.id) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.path)
                        .font(.body.monospaced())
                        .lineLimit(2)

                    let meta = changeMetaLabel(for: item)
                    if !meta.isEmpty {
                        Text(meta)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func transcriptEntryCard(_ entry: DextunnelTranscriptEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(transcriptSpeakerLabel(for: entry))
                    .font(.caption.weight(.semibold))
                Spacer()
                if let timestamp = transcriptTimestampText(entry.timestamp) {
                    Text(timestamp)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if let metaLabel = transcriptMetaLabel(for: entry) {
                Text(metaLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(DextunnelOperatorCore.attributedTranscriptText(for: entry))
                .font(compactTranscriptTextSize.regularFont)
                .lineSpacing(compactTranscriptTextSize.lineSpacing)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(transcriptBackgroundColor(for: entry), in: RoundedRectangle(cornerRadius: 14))
    }

    private func compactTranscriptEntryRow(_ entry: DextunnelTranscriptEntry) -> some View {
        let outgoing = entry.role == "user"
        let caption = compactTranscriptCaption(for: entry)

        return HStack(alignment: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                if let caption, !caption.isEmpty {
                    Text(caption)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(outgoing ? Color.white.opacity(0.82) : Color.secondary)
                }

                Text(DextunnelOperatorCore.attributedTranscriptText(for: entry))
                    .font(compactTranscriptTextSize.compactFont)
                    .lineSpacing(compactTranscriptTextSize.lineSpacing)
                    .foregroundStyle(outgoing ? Color.white : Color.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(compactTranscriptBubbleColor(for: entry), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.horizontal, compactTranscriptTextSize.edgeInset)
    }

    private func compactTranscriptCaption(for entry: DextunnelTranscriptEntry) -> String? {
        let speaker = transcriptSpeakerLabel(for: entry).trimmingCharacters(in: .whitespacesAndNewlines)
        let meta = transcriptMetaLabel(for: entry)

        if transcriptFilters == [.thread] {
            if entry.role == "user" {
                return nil
            }
            if entry.role == "assistant" && (speaker.isEmpty || speaker.lowercased() == "codex" || speaker.lowercased() == "assistant") {
                return nil
            }
        }

        var parts: [String] = []
        if !speaker.isEmpty {
            parts.append(speaker)
        }
        if let meta, !meta.isEmpty {
            parts.append(meta)
        }

        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var transcriptPlaceholderText: String {
        if transcriptFilters.isEmpty {
            return "No filters selected. Tap a category to show it again."
        }
        if transcriptFilters.count == 1, let only = transcriptFilters.first {
            return only.emptyStateCopy
        }
        return "No visible activity for the selected filters yet."
    }

    private func toggleTranscriptFilter(_ filter: DextunnelTranscriptFilter) {
        if transcriptFilters.contains(filter) {
            transcriptFilters.remove(filter)
        } else {
            transcriptFilters.insert(filter)
        }
    }

    private func scrollCompactTranscriptToPreferredPosition(using proxy: ScrollViewProxy, animated: Bool) {
        Task { @MainActor in
            await Task.yield()
            let hasTranscriptContent = !compactVisibleTranscriptEntries.isEmpty || transcriptHasChangeSection
            let targetAnchor = hasTranscriptContent ? compactTranscriptBottomAnchor : compactTranscriptTopAnchor
            let anchor: UnitPoint = hasTranscriptContent ? .bottom : .top
            if animated {
                withAnimation(.easeInOut(duration: 0.22)) {
                    proxy.scrollTo(targetAnchor, anchor: anchor)
                }
            } else {
                proxy.scrollTo(targetAnchor, anchor: anchor)
            }
        }
    }

    private func scrollCompactTranscriptToLatest(using proxy: ScrollViewProxy, animated: Bool) {
        Task { @MainActor in
            await Task.yield()
            if animated {
                withAnimation(.easeInOut(duration: 0.22)) {
                    proxy.scrollTo(compactTranscriptBottomAnchor, anchor: .bottom)
                }
            } else {
                proxy.scrollTo(compactTranscriptBottomAnchor, anchor: .bottom)
            }
        }
    }

    private var compactTranscriptTextSize: CompactTranscriptTextSize {
        CompactTranscriptTextSize(rawValue: transcriptTextSizeRawValue) ?? .extraSmall
    }

    private func compactTranscriptBubbleColor(for entry: DextunnelTranscriptEntry) -> Color {
        if entry.role == "user" {
            return Color.accentColor.opacity(colorScheme == .dark ? 0.92 : 0.94)
        }
        if entry.role == "tool" {
            return Color.white.opacity(colorScheme == .dark ? 0.08 : 0.56)
        }
        return Color.white.opacity(colorScheme == .dark ? 0.08 : 0.62)
    }

    private func transcriptSpeakerLabel(for entry: DextunnelTranscriptEntry) -> String {
        let participantLabel = entry.participant?.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !participantLabel.isEmpty {
            return participantLabel
        }
        let lane = entry.lane?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !lane.isEmpty {
            return lane
        }
        return entry.role
    }

    private func transcriptMetaLabel(for entry: DextunnelTranscriptEntry) -> String? {
        DextunnelOperatorCore.transcriptMetaSummary(for: entry)
    }

    private func transcriptTimestampText(_ value: String?) -> String? {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else {
            return nil
        }

        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private func threadListPreviewText(for thread: DextunnelThreadSummary) -> String? {
        let preferredPreview =
            selectedThreadPreviewOverride(for: thread) ??
            thread.preview ??
            thread.openingPreview
        guard let preview = preferredPreview?.trimmingCharacters(in: .whitespacesAndNewlines), !preview.isEmpty else {
            return nil
        }

        let plain = String(DextunnelOperatorCore.attributedTranscriptText(from: preview).characters)
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !plain.isEmpty else {
            return nil
        }

        return plain
    }

    private func selectedThreadPreviewOverride(for thread: DextunnelThreadSummary) -> String? {
        guard thread.id == store.selectedThreadId else {
            return nil
        }

        let transcript = store.livePayload?.selectedThreadSnapshot?.transcript ?? []
        let latestEntry = transcript
            .reversed()
            .first { entry in
                let text = String(entry.text).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else {
                    return false
                }

                if entry.kind == "commentary" {
                    return false
                }

                return entry.role == "assistant" || entry.role == "user"
            }

        let text = latestEntry?.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }

    @ViewBuilder
    private func threadRowStatusIndicator(
        isPendingSelection: Bool,
        isCurrentSelection: Bool
    ) -> some View {
        ZStack {
            if isPendingSelection {
                ProgressView()
                    .controlSize(.small)
                    .tint(Color.accentColor)
            } else if isCurrentSelection {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.accentColor)
            }
        }
        .frame(width: 18, height: 18, alignment: .center)
        .accessibilityLabel(isPendingSelection ? "Switching" : (isCurrentSelection ? "Selected" : ""))
    }

    private func settlePendingChannelSelectionIfNeeded() {
        guard let pendingChannelSelectionId else {
            return
        }

        guard !store.isSelecting else {
            return
        }

        if store.selectedThreadId == pendingChannelSelectionId {
            self.pendingChannelSelectionId = nil
            withAnimation(.easeInOut(duration: 0.18)) {
                isChannelSheetPresented = false
            }
            return
        }

        let hasVisibleError = !(store.lastErrorMessage?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        if hasVisibleError {
            self.pendingChannelSelectionId = nil
        }
    }

    private func threadListTitle(for thread: DextunnelThreadSummary) -> String {
        let threadTitle = String(thread.channelLabel ?? thread.name ?? thread.id)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let projectTitle = threadListProjectTitle(for: thread)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !projectTitle.isEmpty else {
            return threadTitle
        }

        if threadTitle.isEmpty {
            return projectTitle
        }

        return "\(projectTitle) - \(threadTitle)"
    }

    private func threadListProjectTitle(for thread: DextunnelThreadSummary) -> String {
        let label = String(thread.serverLabel ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !label.isEmpty {
            return label
        }

        let cwd = String(thread.cwd ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cwd.isEmpty else {
            return ""
        }

        let candidate = URL(fileURLWithPath: cwd).lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        return candidate
    }

    private func threadListUpdatedAtText(_ value: String?) -> String? {
        guard let date = parsedThreadUpdatedAt(value) else {
            return nil
        }

        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func parsedThreadUpdatedAt(_ value: String?) -> Date? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }

        if let date = ISO8601DateFormatter().date(from: value) {
            return date
        }

        guard let number = Double(value) else {
            return nil
        }

        let seconds = number > 1_000_000_000_000 ? number / 1000 : number
        return Date(timeIntervalSince1970: seconds)
    }

    private func transcriptBackgroundColor(for entry: DextunnelTranscriptEntry) -> Color {
        switch entry.role {
        case "assistant":
            return Color.white.opacity(colorScheme == .dark ? 0.08 : 0.56)
        case "user":
            return Color.accentColor.opacity(colorScheme == .dark ? 0.16 : 0.12)
        case "tool":
            return Color(uiColor: .systemGray6)
        default:
            return Color.white.opacity(colorScheme == .dark ? 0.08 : 0.56)
        }
    }

    private func changeMetaLabel(for item: DextunnelTurnDiffItem) -> String {
        let parts: [String] = [
            item.status?.trimmingCharacters(in: .whitespacesAndNewlines),
            item.additions.map { "+\($0)" },
            item.deletions.map { "-\($0)" }
        ]
        .compactMap { value in
            guard let value, !value.isEmpty else {
                return nil
            }
            return value
        }

        return parts.joined(separator: " / ")
    }

    @ViewBuilder
    private func queueDeliveryStatusLabel(for draft: DextunnelQueuedDraft) -> some View {
        switch draft.deliveryState {
        case .queued:
            Label("Queued locally", systemImage: "clock")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .sending:
            HStack(spacing: 6) {
                ProgressView()
                    .controlSize(.small)
                Text("Sending")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .failed:
            Label("Send failed", systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.orange)
        case .delivered:
            Label("Accepted by bridge", systemImage: "tray.and.arrow.down.fill")
                .font(.caption)
                .foregroundStyle(.green)
        case .confirmed:
            Label("Seen in room", systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
        }
    }

    private var busyStatusLine: String? {
        if store.isSending {
            return "Sending"
        }
        if store.isSelecting {
            return "Switching room"
        }
        if store.isRefreshing {
            return "Refreshing"
        }
        if store.connectionPhase == .connecting {
            return "Connecting"
        }
        if store.connectionPhase == .reconnecting {
            return "Reconnecting"
        }
        return nil
    }
}

private enum CompactInfoTone {
    case accent
    case secondary
    case warning

    var foreground: Color {
        switch self {
        case .accent:
            return .accentColor
        case .secondary:
            return .secondary
        case .warning:
            return .red
        }
    }

    var background: Color {
        switch self {
        case .accent:
            return Color.accentColor.opacity(0.12)
        case .secondary:
            return Color(uiColor: .secondarySystemBackground)
        case .warning:
            return Color.red.opacity(0.1)
        }
    }
}

private struct DextunnelDictationActivityView: View {
    @State private var isAnimating = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<4, id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(Color.accentColor)
                    .frame(width: 4, height: isAnimating ? CGFloat(10 + (index * 4)) : 10)
                    .animation(
                        .easeInOut(duration: 0.45)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.08),
                        value: isAnimating
                    )
            }
        }
        .frame(height: 24)
        .task {
            isAnimating = true
        }
    }
}

public enum DextunnelAppearancePreference: String, CaseIterable, Identifiable, Sendable {
    case followSystem
    case light
    case dark

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .followSystem:
            return "Follow system"
        case .light:
            return "Light"
        case .dark:
            return "Dark"
        }
    }

    public var colorScheme: ColorScheme? {
        switch self {
        case .followSystem:
            return nil
        case .light:
            return .light
        case .dark:
            return .dark
        }
    }
}

private extension View {
    func dextunnelGlassCard(cornerRadius: CGFloat = 18) -> some View {
        self
            .background(
                .ultraThinMaterial,
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.16), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 16, y: 8)
    }

    func dextunnelGlassChrome(cornerRadius: CGFloat = 0, shadowOpacity: Double = 0.06) -> some View {
        self
            .background(
                .ultraThinMaterial,
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
            .overlay(
                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(height: 1),
                alignment: .bottom
            )
            .shadow(color: Color.black.opacity(shadowOpacity), radius: 18, y: 8)
    }
}

private enum CompactTranscriptTextSize: String, CaseIterable, Identifiable {
    case extraSmall
    case small
    case standard
    case large

    var id: String { rawValue }

    var title: String {
        switch self {
        case .extraSmall:
            return "Extra small"
        case .small:
            return "Small"
        case .standard:
            return "Default"
        case .large:
            return "Large"
        }
    }

    var compactFont: Font {
        switch self {
        case .extraSmall:
            return .footnote
        case .small:
            return .subheadline
        case .standard:
            return .callout
        case .large:
            return .body
        }
    }

    var regularFont: Font {
        switch self {
        case .extraSmall:
            return .subheadline
        case .small:
            return .callout
        case .standard:
            return .body
        case .large:
            return .title3
        }
    }

    var lineSpacing: CGFloat {
        switch self {
        case .extraSmall:
            return 1.5
        case .small:
            return 2
        case .standard:
            return 3
        case .large:
            return 4
        }
    }

    var edgeInset: CGFloat {
        switch self {
        case .extraSmall:
            return 18
        case .small:
            return 20
        case .standard:
            return 24
        case .large:
            return 28
        }
    }

    var outgoingTrailingInset: CGFloat {
        switch self {
        case .extraSmall:
            return 28
        case .small:
            return 28
        case .standard:
            return 30
        case .large:
            return 32
        }
    }

    var outgoingLeadingInset: CGFloat {
        switch self {
        case .extraSmall:
            return 8
        case .small:
            return 8
        case .standard:
            return 10
        case .large:
            return 12
        }
    }
}

private struct CompactTranscriptBottomMarkerPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct CompactTranscriptContentHeightPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
#endif

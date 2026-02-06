import streamDeck, { action, DidReceiveDeepLinkEvent, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { createServer, IncomingMessage, ServerResponse } from "http";

// Session state types
type SessionState = "idle" | "working" | "waiting";

interface SessionInfo {
  sessionId: string;
  state: SessionState;
  project: string;
  app: string;
  lastUpdate: number;
  pid: number | null;
}

interface DeepLinkPayload {
  session_id: string;
  state: SessionState;
  project: string;
  app?: string;
  pid?: number;
  action: "update" | "remove";
}

// Track all active sessions
const sessions = new Map<string, SessionInfo>();

// Track button contexts - maps context ID to { sessionId, position }
interface ButtonInfo {
  sessionId: string | null;
  position: number; // row * 100 + column for sorting
}
const buttonContexts = new Map<string, ButtonInfo>();

// Track available (unclaimed) buttons - stores context IDs
const availableButtons = new Set<string>();

// SVG templates for button images
const svgTemplates = {
  idle: `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="20" fill="#22c55e"/>
    <text x="72" y="38" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.7)" text-anchor="middle">{{APP}}</text>
    <text x="72" y="72" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="bold" fill="white" text-anchor="middle">{{LABEL}}</text>
    <text x="72" y="105" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.85)" text-anchor="middle">Ready to Work</text>
  </svg>`,
  working: `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="20" fill="#eab308"/>
    <text x="72" y="38" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.7)" text-anchor="middle">{{APP}}</text>
    <text x="72" y="72" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="bold" fill="white" text-anchor="middle">{{LABEL}}</text>
    <text x="72" y="105" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.85)" text-anchor="middle">Crunching Bytes</text>
  </svg>`,
  waiting: `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="20" fill="#ef4444"/>
    <text x="72" y="38" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.7)" text-anchor="middle">{{APP}}</text>
    <text x="72" y="72" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="bold" fill="white" text-anchor="middle">{{LABEL}}</text>
    <text x="72" y="105" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="rgba(255,255,255,0.85)" text-anchor="middle">Needs Input</text>
  </svg>`,
  empty: `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="20" fill="#374151"/>
    <text x="72" y="65" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#9ca3af" text-anchor="middle">Connect</text>
    <text x="72" y="90" font-family="system-ui, -apple-system, sans-serif" font-size="14" fill="#6b7280" text-anchor="middle">Claude</text>
  </svg>`,
};

function generateSvgImage(state: SessionState | "empty", label: string, app: string = ""): string {
  const template = svgTemplates[state];
  // Truncate label if too long (12 chars max with smaller font)
  const truncatedLabel = label.length > 12 ? label.substring(0, 11) + "…" : label;
  const svg = template
    .replace("{{LABEL}}", truncatedLabel)
    .replace("{{APP}}", app);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function findButtonForSession(sessionId: string): string | undefined {
  for (const [context, info] of buttonContexts) {
    if (info.sessionId === sessionId) {
      return context;
    }
  }
  return undefined;
}

function claimButtonForSession(sessionId: string): string | undefined {
  // Check if session already has a button
  const existing = findButtonForSession(sessionId);
  if (existing) return existing;

  // Find an available button - sort by position (lowest first: top-left to bottom-right)
  const sortedAvailable = Array.from(availableButtons).sort((a, b) => {
    const posA = buttonContexts.get(a)?.position ?? Infinity;
    const posB = buttonContexts.get(b)?.position ?? Infinity;
    return posA - posB;
  });

  const available = sortedAvailable[0];
  if (available) {
    availableButtons.delete(available);
    const info = buttonContexts.get(available);
    if (info) {
      info.sessionId = sessionId;
      buttonContexts.set(available, info);
    }
    return available;
  }
  return undefined;
}

function releaseButton(context: string): void {
  const info = buttonContexts.get(context);
  if (info) {
    info.sessionId = null;
    buttonContexts.set(context, info);
  }
  availableButtons.add(context);
}

async function updateButton(context: string, session: SessionInfo | null): Promise<void> {
  const action = streamDeck.actions.getActionById(context);
  if (!action) {
    streamDeck.logger.warn(`Could not find action for context: ${context}`);
    return;
  }

  if (session) {
    const image = generateSvgImage(session.state, session.project, session.app);
    await action.setImage(image);
  } else {
    const image = generateSvgImage("empty", "", "");
    await action.setImage(image);
  }
}

async function playAlertSound(): Promise<void> {
  // Use afplay to play system sound without opening any application
  // This runs in background and doesn't steal focus
  const { exec } = await import("child_process");
  exec('afplay /System/Library/Sounds/Funk.aiff &');
}

// Register a button as available
function registerButton(context: string, row: number = 0, column: number = 0): void {
  if (!buttonContexts.has(context)) {
    const position = row * 100 + column; // Allows sorting by row then column
    buttonContexts.set(context, { sessionId: null, position });
    availableButtons.add(context);
    streamDeck.logger.info(`Registered button: ${context} at row=${row}, col=${column}, position=${position}, total available: ${availableButtons.size}`);
  }
}

// Unregister a button
function unregisterButton(context: string): void {
  const info = buttonContexts.get(context);
  buttonContexts.delete(context);
  availableButtons.delete(context);
  streamDeck.logger.info(`Unregistered button: ${context}, was tracking session: ${info?.sessionId}`);
}

// The main action class
@action({ UUID: "com.claude.status.action" })
export class ClaudeStatusAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const context = ev.action.id;
    // Extract coordinates from the event payload
    const coordinates = (ev.payload as { coordinates?: { row: number; column: number } })?.coordinates;
    const row = coordinates?.row ?? 0;
    const column = coordinates?.column ?? 0;
    streamDeck.logger.info(`[Class] Button appeared: ${context} at row=${row}, col=${column}`);
    registerButton(context, row, column);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const context = ev.action.id;
    streamDeck.logger.info(`[Class] Button disappeared: ${context}`);
    unregisterButton(context);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const context = ev.action.id;
    const info = buttonContexts.get(context);
    streamDeck.logger.info(`Button pressed: ${context}, session: ${info?.sessionId || 'none'}`);

    if (info?.sessionId) {
      const session = sessions.get(info.sessionId);
      if (session?.app) {
        // Focus the application using AppleScript
        const { exec } = await import("child_process");
        const appName = session.app;
        exec(`osascript -e 'tell application "${appName}" to activate'`, (error) => {
          if (error) {
            streamDeck.logger.warn(`Failed to activate ${appName}: ${error.message}`);
          } else {
            streamDeck.logger.info(`Activated ${appName}`);
          }
        });
      }
    }
  }
}

// Also register global listeners as backup (catches all actions)
streamDeck.actions.onWillAppear((ev: WillAppearEvent) => {
  // Only handle our action type
  if (ev.action.manifestId === "com.claude.status.action") {
    const context = ev.action.id;
    const coordinates = (ev.payload as { coordinates?: { row: number; column: number } })?.coordinates;
    const row = coordinates?.row ?? 0;
    const column = coordinates?.column ?? 0;
    streamDeck.logger.info(`[Global] Button appeared: ${context} at row=${row}, col=${column}`);
    registerButton(context, row, column);
  }
});

streamDeck.actions.onWillDisappear((ev: WillDisappearEvent) => {
  if (ev.action.manifestId === "com.claude.status.action") {
    const context = ev.action.id;
    streamDeck.logger.info(`[Global] Button disappeared: ${context}`);
    unregisterButton(context);
  }
});

// Handle deep links from Claude hooks
streamDeck.system.onDidReceiveDeepLink(async (ev: DidReceiveDeepLinkEvent) => {
  try {
    // The path contains our URL-encoded JSON payload (with leading slash)
    // Deep link format: streamdeck://plugins/message/com.claude.status/{encoded_payload}
    const encodedPayload = ev.url.path.startsWith("/") ? ev.url.path.slice(1) : ev.url.path;
    const payloadStr = decodeURIComponent(encodedPayload);
    const payload: DeepLinkPayload = JSON.parse(payloadStr);

    streamDeck.logger.info(`Received deep link: ${JSON.stringify(payload)}`);
    streamDeck.logger.info(`Available buttons: ${availableButtons.size}, contexts: ${Array.from(buttonContexts.keys()).join(', ')}`);

    if (payload.action === "remove") {
      // Session ended - release the button
      const context = findButtonForSession(payload.session_id);
      if (context) {
        sessions.delete(payload.session_id);
        releaseButton(context);
        await updateButton(context, null);
        streamDeck.logger.info(`Released button for session: ${payload.session_id}`);
      }
      return;
    }

    // Update or create session
    const existingSession = sessions.get(payload.session_id);
    const previousState = existingSession?.state;

    const session: SessionInfo = {
      sessionId: payload.session_id,
      state: payload.state,
      project: payload.project || "claude",
      app: payload.app || existingSession?.app || "Terminal",
      lastUpdate: Date.now(),
      pid: (payload.pid != null && payload.pid > 0) ? payload.pid : (existingSession?.pid ?? null),
    };

    sessions.set(payload.session_id, session);

    // Find or claim a button
    let context = findButtonForSession(payload.session_id);
    if (!context) {
      context = claimButtonForSession(payload.session_id);
    }

    if (context) {
      await updateButton(context, session);

      // Play sound if transitioning to waiting state
      if (payload.state === "waiting" && previousState !== "waiting") {
        await playAlertSound();
      }

      streamDeck.logger.info(`Updated button ${context} for session ${payload.session_id}: ${payload.state}`);
    } else {
      streamDeck.logger.warn(`No available buttons for session: ${payload.session_id}`);
    }
  } catch (error) {
    streamDeck.logger.error(`Error processing deep link: ${error}`);
  }
});

// HTTP server for receiving status updates without focus stealing
const HTTP_PORT = 31548; // Arbitrary port for local communication

async function handleHttpRequest(payload: DeepLinkPayload): Promise<void> {
  streamDeck.logger.info(`HTTP received: ${JSON.stringify(payload)}`);
  streamDeck.logger.info(`Available buttons: ${availableButtons.size}, contexts: ${Array.from(buttonContexts.keys()).join(', ')}`);

  if (payload.action === "remove") {
    // Session ended - release the button
    const context = findButtonForSession(payload.session_id);
    if (context) {
      sessions.delete(payload.session_id);
      releaseButton(context);
      await updateButton(context, null);
      streamDeck.logger.info(`Released button for session: ${payload.session_id}`);
    }
    return;
  }

  // Update or create session
  const existingSession = sessions.get(payload.session_id);
  const previousState = existingSession?.state;

  const session: SessionInfo = {
    sessionId: payload.session_id,
    state: payload.state,
    project: payload.project || "claude",
    app: payload.app || existingSession?.app || "Terminal",
    lastUpdate: Date.now(),
    pid: (payload.pid != null && payload.pid > 0) ? payload.pid : (existingSession?.pid ?? null),
  };

  sessions.set(payload.session_id, session);

  // Find or claim a button
  let context = findButtonForSession(payload.session_id);
  if (!context) {
    context = claimButtonForSession(payload.session_id);
  }

  if (context) {
    await updateButton(context, session);

    // Play sound if transitioning to waiting state
    if (payload.state === "waiting" && previousState !== "waiting") {
      await playAlertSound();
    }

    streamDeck.logger.info(`Updated button ${context} for session ${payload.session_id}: ${payload.state}`);
  } else {
    streamDeck.logger.warn(`No available buttons for session: ${payload.session_id}`);
  }
}

// Check if a process is still alive AND is a node/claude process (guards against PID reuse)
function isClaudeProcessAlive(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    import("child_process").then(({ exec }) => {
      exec(`ps -p ${pid} -o comm=`, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        const cmd = stdout.trim().toLowerCase();
        // Verify it's still a node/claude process, not a reused PID
        resolve(cmd.includes("node") || cmd.includes("claude"));
      });
    });
  });
}

// Staleness timeout: clean up sessions with no updates for this long (ms)
const STALE_SESSION_TIMEOUT_MS = 120_000; // 2 minutes

// Periodically check for orphaned sessions and clean them up
async function checkOrphanedSessions(): Promise<void> {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    let shouldCleanUp = false;

    if (session.pid) {
      // Primary check: is the actual process still alive and still claude/node?
      const alive = await isClaudeProcessAlive(session.pid);
      if (!alive) {
        streamDeck.logger.info(`Session ${sessionId} (pid ${session.pid}) is dead, cleaning up orphaned button`);
        shouldCleanUp = true;
      }
    } else {
      // No PID available - fall back to staleness check
      const age = now - session.lastUpdate;
      if (age > STALE_SESSION_TIMEOUT_MS) {
        streamDeck.logger.info(`Session ${sessionId} has no PID and is stale (${Math.round(age / 1000)}s), cleaning up`);
        shouldCleanUp = true;
      }
    }

    if (shouldCleanUp) {
      const context = findButtonForSession(sessionId);
      if (context) {
        sessions.delete(sessionId);
        releaseButton(context);
        await updateButton(context, null);
      } else {
        sessions.delete(sessionId);
      }
    }
  }
}

function startOrphanChecker(): void {
  const INTERVAL_MS = 5000; // Check every 5 seconds
  setInterval(() => {
    checkOrphanedSessions().catch((err) => {
      streamDeck.logger.error(`Orphan check error: ${err}`);
    });
  }, INTERVAL_MS);
  streamDeck.logger.info("Orphan session checker started (5s interval)");
}

function startHttpServer(): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Debug endpoint: GET /status returns all tracked sessions
    if (req.method === "GET" && req.url === "/status") {
      const sessionList = Array.from(sessions.entries()).map(([id, s]) => ({
        sessionId: id,
        state: s.state,
        project: s.project,
        app: s.app,
        pid: s.pid,
        lastUpdate: new Date(s.lastUpdate).toISOString(),
        ageSec: Math.round((Date.now() - s.lastUpdate) / 1000),
      }));
      const buttonList = Array.from(buttonContexts.entries()).map(([ctx, info]) => ({
        context: ctx.substring(0, 8) + "...",
        sessionId: info.sessionId,
        position: info.position,
        available: availableButtons.has(ctx),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions: sessionList, buttons: buttonList }, null, 2));
      return;
    }

    if (req.method === "POST" && req.url === "/status") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", async () => {
        try {
          const payload: DeepLinkPayload = JSON.parse(body);
          await handleHttpRequest(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          streamDeck.logger.error(`HTTP error: ${error}`);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(HTTP_PORT, "127.0.0.1", () => {
    streamDeck.logger.info(`HTTP server listening on http://127.0.0.1:${HTTP_PORT}`);
  });

  server.on("error", (err) => {
    streamDeck.logger.error(`HTTP server error: ${err}`);
  });
}

// Log startup
streamDeck.logger.info("Claude Status plugin starting...");

// Start HTTP server for background communication
startHttpServer();

// Start periodic orphan session cleanup
startOrphanChecker();

// Explicitly register the action (belt and suspenders)
const claudeAction = new ClaudeStatusAction();
streamDeck.actions.registerAction(claudeAction);

// Connect to Stream Deck
streamDeck.connect();

streamDeck.logger.info("Claude Status plugin connected and action registered.");

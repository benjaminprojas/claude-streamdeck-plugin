# Claude Code Stream Deck Plugin

Display your Claude Code session status on your Stream Deck. Shows which app Claude is running in, the project name, and current status with color-coded buttons.

## Features

- **Green** - Ready to Work (Claude is idle, waiting for input)
- **Yellow** - Crunching Bytes (Claude is working)
- **Red** - Needs Input (Claude needs permission or is waiting)
- **Gray** - Connect Claude (no active session on this button)

Additional features:
- Shows the terminal/IDE app name (Hyper, Cursor, VS Code, etc.)
- Shows the project directory name
- Plays a sound when Claude needs input
- Click a button to focus that app
- Buttons are assigned in order (top-left to bottom-right)
- Sessions automatically disconnect when closed

## Requirements

- macOS 10.15 or later
- Stream Deck software 6.9 or later
- Claude Code CLI installed
- `jq` installed (`brew install jq`)

## Installation

### Step 1: Install the Stream Deck Plugin

1. Double-click `com.claude.status.streamDeckPlugin` to install it
2. The Stream Deck software will open and install the plugin automatically

### Step 2: Install the Hook Script

1. Copy `streamdeck-status.sh` to your Claude hooks folder:
   ```bash
   mkdir -p ~/.claude/hooks
   cp streamdeck-status.sh ~/.claude/hooks/
   chmod +x ~/.claude/hooks/streamdeck-status.sh
   ```

### Step 3: Configure Claude Code Hooks

Add the following to your `~/.claude/settings.json` file. If the file doesn't exist, create it:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/streamdeck-status.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/streamdeck-status.sh"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/streamdeck-status.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/streamdeck-status.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/streamdeck-status.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/streamdeck-status.sh"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/streamdeck-status.sh"
          }
        ]
      }
    ]
  }
}
```

If you already have a `settings.json` with other settings, merge the hooks section.

### Step 4: Add Buttons to Stream Deck

1. Open Stream Deck software
2. Find "Claude Code" in the actions list on the right
3. Drag "Claude Status" buttons onto your Stream Deck
4. Add as many buttons as you want (sessions will be assigned in order)

## Usage

1. Start a Claude Code session in any terminal (Hyper, iTerm, Terminal, etc.) or IDE (Cursor, VS Code, Zed)
2. The first available Stream Deck button will show your session
3. The button shows:
   - Top: App name (e.g., "Hyper")
   - Middle: Project name (e.g., "my-project")
   - Bottom: Status (e.g., "Ready to Work")
4. Click a button to focus that app
5. When Claude needs input, the button turns red and plays a sound

## Customization

### Change the Alert Sound

Edit `~/.claude/hooks/streamdeck-status.sh` or the plugin source and change the sound file path. Available macOS sounds:
- `/System/Library/Sounds/Funk.aiff` (default)
- `/System/Library/Sounds/Glass.aiff`
- `/System/Library/Sounds/Ping.aiff`
- `/System/Library/Sounds/Pop.aiff`
- And more in `/System/Library/Sounds/`

### Add Support for Other Terminal Apps

Edit the `detect_parent_app()` function in `streamdeck-status.sh` to add more app patterns.

## Troubleshooting

### Buttons not updating
- Make sure the hook script is executable: `chmod +x ~/.claude/hooks/streamdeck-status.sh`
- Check that `jq` is installed: `brew install jq`
- Verify hooks are configured in `~/.claude/settings.json`

### Wrong app detected
- The app is detected on session start; restart Claude to re-detect
- Add your terminal app to the detection list in `streamdeck-status.sh`

### Sessions not disconnecting
- Make sure `SessionEnd` hook is configured
- Restart Stream Deck software if needed

## License

MIT License - feel free to modify and share!

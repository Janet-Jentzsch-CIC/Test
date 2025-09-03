# SC Magdeburg Handball Goal Tracker

A simple, robust, modern-looking tool for handball coaches to track goal information during matches.

## Features

- Register goals with just two clicks: shot position and goal entry point
- Dual timers: game time (can be paused/resumed) and current time
- Real-time statistics updated after each shot
- View statistics by shot positions, goal areas, and combinations
- Export data as CSV for further analysis
- Designed specifically for iPad use with touch-optimized interface
- Team colors: Green (#006521) and Red (#d91319) for SC Magdeburg
- Area edit mode to customize shooting and goal positions

## iPad Setup Guide (For Coaches)

### Option 1: Using GitHub Pages (Easiest - No Installation)

1. Open this URL in Safari on your iPad:
   `https://your-github-username.github.io/SC-Magdeburg-Video-Assistant-Private/Tor_Register/` (the team admin will
   provide the exact URL)

2. Add to Home Screen (makes it work like a regular app):
    - Tap the Share button (square with arrow) at the bottom of Safari
    - Scroll down and tap "Add to Home Screen"
    - Name it "Handball Tracker" and tap "Add"

3. Now you can open the app directly from your iPad home screen - even without internet (after first use)

### Option 2: Using a Simple Local Server

If you need to run the app where internet access is limited:

1. Install the free "Web Server for Chrome" app on your iPad
    - Open the App Store on your iPad
    - Search for "Web Server for Chrome" and install it

2. Setup the web server:
    - Open the app
    - Tap "CHOOSE FOLDER" and select the folder containing the tracker files
    - Toggle the server to "STARTED"
    - Note the web address shown (usually http://127.0.0.1:8887)

3. Open Safari and navigate to the address shown

4. Add to Home Screen as described in Option 1

## How to Use the Tracker During Matches

1. Open the app from your iPad home screen

2. Use the game timer controls to track match time
    - Tap "Start" to begin the game timer
    - Tap again to pause when needed
    - Use "Reset" between periods

3. Register shots:
    - Step 1: Tap on the court to indicate where the shot was taken from
    - Step 2: Tap on the goal to indicate where the ball entered

4. View statistics in the tabs below
    - Shot Positions: Shows success rate from different court positions
    - Goal Areas: Shows distribution of goals across the goal sections
    - Combinations: Shows relationships between shot positions and goal areas

5. Use control buttons:
    - "Undo Last Shot": Removes the most recent shot recorded
    - "Export Data": Saves shot data as a CSV file for later analysis
    - "Clear All": Resets all data (use at start of new match)

6. Edit Areas Mode (for customizing the layout):
    - Tap "Enter Area Edit Mode" to customize shot and goal positions
    - Drag areas to reposition them
    - Drag corners to resize
    - Tap "Exit Area Edit Mode" when finished

## Support

For technical support, please contact your team administrator.

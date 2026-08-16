#!/usr/bin/env bash
# =========================================================
#  🎨 Image Blur Studio - 1-Command Startup Script
# =========================================================

set -e
cd "$(dirname "$0")"

echo ""
echo "🚀 Starting Image Blur Studio..."
echo ""

# Install npm dependencies if missing
if [ ! -d "node_modules" ]; then
  echo "📦 Installing npm dependencies (first run)..."
  npm install
fi

# Ensure Python processor has executable permissions
chmod +x blur_processor.py

echo ""
echo "========================================================="
echo "  🌐 Backend API:  http://localhost:3333"
echo "  💻 WebApp Studio: http://localhost:5173"
echo "========================================================="
echo ""

# Start backend server in background and frontend dev server
node server.js &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true" EXIT

npm run dev

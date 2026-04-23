#!/bin/bash
# VIXOL GitHub Push + npm Publish
# Execute after SSH key is added to GitHub account

set -e

echo "=== VIXOL GITHUB PUSH + NPM PUBLISH ==="
echo

cd /opt/vixol-public

echo "1. Verify SSH connection:"
ssh -i ~/.ssh/github_vixol -T git@github.com || echo "⚠️ SSH not ready yet"
echo

echo "2. Push to GitHub (main branch):"
git push -u origin main
echo "✅ Pushed to GitHub!"
echo

echo "3. Verify push:"
git log --oneline -1
echo

echo "4. Check package.json version:"
grep '"version"' package.json
echo

echo "5. Publish to npm registry:"
npm publish --access public
echo "✅ Published to npm!"
echo

echo "=== COMPLETE ==="
echo "✅ VIXOL live on GitHub: https://github.com/thomasl-99/vixol"
echo "✅ VIXOL live on npm: https://www.npmjs.com/package/vixol"
echo
echo "Users can now install:"
echo "  npm install vixol"
echo
echo "🚀 VIXOL OFFICIALLY LAUNCHED!"

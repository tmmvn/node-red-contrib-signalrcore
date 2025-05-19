[![npm version](https://badge.fury.io/js/node-red-contrib-signalrcore.svg)](//www.npmjs.com/package/node-red-contrib-signalrcore)

# node-red-contrib-signalrcore

SignalR In and Out nodes for Node RED

# Mods:

- Upgraded to latest 8.0
- Added support for auth factory
- Made error handling more robust
- Aligned to current Node RED
- Added invoke method (some SignalR hubs seem to expect sends and invokes,
  might be an issue more on the server implementer side but hey, might as well
  have that)

## Usage:

- Do an npm install
- Do an npm pack
- Upload the tgz to Node RED
- Profit

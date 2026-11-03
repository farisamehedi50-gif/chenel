{
  "version": 2,
  "builds": [
    {
      "src": "chenel.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "chenel.js"
    }
  ]
}

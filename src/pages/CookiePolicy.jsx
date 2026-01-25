import React from "react";

export default function CookiePolicy() {
  return (
    <main style={ maxWidth: 900, margin: "0 auto", padding: "48px 20px", lineHeight: 1.6 }>
      <header style={ marginBottom: 24 }>
        <h1 style={ fontSize: 40, margin: 0 }>Cookie Policy</h1>
        <p style={ marginTop: 8, color: "rgba(255,255,255,0.75)" }>
          Last updated: 25 January 2026
        </p>
      </header>

      <article style={ fontSize: 16 }>
        <p style={ margin: "0 0 14px" }>This Cookie Policy explains how we use cookies and similar technologies on this website.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>1. What are cookies?</h2>
        <p style={ margin: "0 0 14px" }>Cookies are small text files stored on your device when you visit a website. They help the site work properly and can help improve your experience.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>2. How we use cookies</h2>
        <p style={ margin: "0 0 14px" }>We use cookies for the following purposes:</p>
        <ul style={ paddingLeft: 20, margin: "0 0 14px" }>
            <li style={ marginBottom: 6 }><strong>Strictly necessary</strong> – to enable core site functionality, security, and login sessions</li>
            <li style={ marginBottom: 6 }><strong>Preferences</strong> – to remember settings (where enabled)</li>
            <li style={ marginBottom: 6 }><strong>Analytics</strong> – to understand how the site is used (only where enabled and where consent is required)</li>
            <li style={ marginBottom: 6 }><strong>Maps/Location features</strong> – to load map tiles and location services (e.g. Google Maps)</li>
        </ul>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>3. Managing cookies</h2>
        <p style={ margin: "0 0 14px" }>You can control and delete cookies using your browser settings. You can also block cookies, but some parts of the site may not work correctly.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>4. Third-party cookies</h2>
        <p style={ margin: "0 0 14px" }>Some features may use third-party services (for example, maps or analytics). These providers may set cookies or similar technologies.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>5. Updates to this policy</h2>
        <p style={ margin: "0 0 14px" }>We may update this Cookie Policy from time to time. Any changes will be posted on this page.</p>
        <h2 style={ fontSize: 24, margin: "28px 0 10px" }>6. Contact</h2>
        <p style={ margin: "0 0 14px" }>If you have any questions about cookies on this site, email <a href="mailto:privacy@yourdomain.co.uk">privacy@yourdomain.co.uk</a>.</p>
      </article>
    </main>
  );
}

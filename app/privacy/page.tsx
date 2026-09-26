export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: September 2026</p>

      <section className="space-y-4">
        <p>
          This app (&quot;LouisCreatesAI DM&quot;) is run by <strong>@louiscreates.ai</strong> for its own Instagram account. It is built on the
          open-source InstaAuto project. The app uses the Instagram Graph API to help users manage
          their Instagram account, including posting reels, auto-replying to
          messages, and viewing analytics.
        </p>

        <h2 className="text-xl font-semibold mt-6">Data We Collect</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Instagram profile information (username, name, profile picture)</li>
          <li>Instagram content (media, captions, comments)</li>
          <li>Messages and conversations (for auto-reply features)</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">How We Use Data</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>To post content to your Instagram account when you request it</li>
          <li>To send automated replies to messages and comments</li>
          <li>To display analytics about your account performance</li>
          <li>We do <strong>not</strong> sell your data to third parties</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">Data Storage</h2>
        <p>
          Your Instagram access tokens and profile data are stored securely in
          our database (Supabase). You can disconnect your account at any time,
          which will remove the stored tokens.
        </p>

        <h2 className="text-xl font-semibold mt-6">Deleting Your Data</h2>
        <p>
          If you commented on or messaged @louiscreates.ai and want the data this app stored about you deleted
          (your Instagram user ID and the messages exchanged), send a direct message to @louiscreates.ai on Instagram
          saying &quot;delete my data&quot;. It is removed within 30 days and you get a confirmation reply.
        </p>

        <h2 className="text-xl font-semibold mt-6">Contact</h2>
        <p>
          For any questions, send a direct message to @louiscreates.ai on Instagram.
        </p>
      </section>
    </div>
  )
}

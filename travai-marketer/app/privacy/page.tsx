import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — TravAI Marketer',
  description: 'Privacy Policy for the TravAI Marketer platform.',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700">
          Back to home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mt-6 mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Last updated: 30 April 2026
        </p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">1. Introduction</h2>
            <p>
              TravAI Marketer (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or
              &ldquo;the Service&rdquo;) is operated by{' '}
              <strong>CodeSphere Agency LLP</strong>. This Privacy Policy
              explains how we collect, use, store, and protect information when
              you or your customers interact with the platform at{' '}
              <code>trav-marketer.vercel.app</code>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              2. Information We Collect
            </h2>
            <p>We collect the following information:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Account information:</strong> Name, email address,
                phone number, and business name of authorized dashboard users.
              </li>
              <li>
                <strong>Customer messages:</strong> WhatsApp messages exchanged
                between your business and your customers, including phone
                numbers, message content, timestamps, and delivery status.
              </li>
              <li>
                <strong>Google Business Profile data:</strong> When you connect
                your Google Business Profile, we access location data, posts,
                and reviews on your behalf strictly to provide the Service.
              </li>
              <li>
                <strong>Usage data:</strong> Login activity, feature usage, and
                error logs needed to operate and improve the Service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              3. How We Use Your Information
            </h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide WhatsApp messaging and AI chatbot functionality</li>
              <li>To manage and publish content to Google Business Profile</li>
              <li>To generate AI-powered responses and marketing content</li>
              <li>To send service-related notifications and support updates</li>
              <li>To analyze platform usage and improve features</li>
            </ul>
            <p>
              <strong>We do not sell, rent, or share your data with third
              parties for advertising purposes.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              4. Google API Services
            </h2>
            <p>
              TravAI Marketer&rsquo;s use and transfer of information received
              from Google APIs adheres to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. Specifically:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                We only access Google Business Profile data with your explicit
                consent through OAuth.
              </li>
              <li>
                We use Google Business Profile data solely to provide the
                features you have enabled (publishing posts, replying to
                reviews, fetching location data).
              </li>
              <li>
                We do not use Google user data for advertising, do not sell it,
                and do not allow humans to read it except where required by
                law, with your consent, or for security and debugging.
              </li>
              <li>
                You may revoke our access at any time via your Google Account
                permissions page.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              5. WhatsApp & Meta Cloud API
            </h2>
            <p>
              Messages sent and received through WhatsApp are processed via the
              official Meta WhatsApp Cloud API. By using this Service, you also
              agree to abide by Meta&rsquo;s{' '}
              <a
                href="https://www.whatsapp.com/legal/business-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline"
              >
                WhatsApp Business Messaging Policy
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              6. Data Storage & Security
            </h2>
            <p>
              All data is stored on PocketBase-backed infrastructure managed on
              the Traventions Oracle environment, encrypted in transit (TLS),
              and restricted to authorized personnel through protected admin
              credentials and role-based access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              7. Data Retention
            </h2>
            <p>
              We retain customer message history and account data for as long
              as your account is active. Upon account closure, data is deleted
              within 30 days unless required for legal compliance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              8. Your Rights
            </h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Access the personal data we hold about you</li>
              <li>Request correction or deletion of your data</li>
              <li>Withdraw consent for Google or WhatsApp integrations</li>
              <li>Export your data in a portable format</li>
            </ul>
            <p>
              To exercise these rights, email us at{' '}
              <a
                href="mailto:hasnainmakada@gmail.com"
                className="text-indigo-600 underline"
              >
                hasnainmakada@gmail.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              9. Children&rsquo;s Privacy
            </h2>
            <p>
              The Service is not directed to individuals under 18. We do not
              knowingly collect data from minors.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              10. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. The
              &ldquo;Last updated&rdquo; date at the top reflects the most
              recent changes. Continued use of the Service after updates
              constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              11. Contact Us
            </h2>
            <p>
              For privacy-related questions or concerns, contact:
              <br />
              <strong>CodeSphere Agency LLP</strong>
              <br />
              Email:{' '}
              <a
                href="mailto:hasnainmakada@gmail.com"
                className="text-indigo-600 underline"
              >
                hasnainmakada@gmail.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

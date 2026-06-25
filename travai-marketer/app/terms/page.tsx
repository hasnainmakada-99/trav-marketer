import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — TravAI Marketer',
  description: 'Terms of Service for the TravAI Marketer platform.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700">
          Back to home
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 mt-6 mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Last updated: 30 April 2026
        </p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              1. Agreement to Terms
            </h2>
            <p>
              By accessing or using TravAI Marketer (the &ldquo;Service&rdquo;)
              at <code>trav-marketer.vercel.app</code>, operated by{' '}
              <strong>CodeSphere Agency LLP</strong> (&ldquo;we&rdquo;,
              &ldquo;us&rdquo;, &ldquo;our&rdquo;), you agree to be bound by
              these Terms of Service. If you do not agree, do not use the
              Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              2. Description of Service
            </h2>
            <p>
              TravAI Marketer is a SaaS platform that provides:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>WhatsApp Business messaging via Meta Cloud API</li>
              <li>AI-generated chatbot responses (powered by OpenAI)</li>
              <li>Google Business Profile post and review management</li>
              <li>CRM, lead pipeline, and marketing campaign tools</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              3. Account Registration
            </h2>
            <p>
              You must provide accurate, current information during registration
              and keep your login credentials confidential. You are responsible
              for all activity under your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              4. Acceptable Use
            </h2>
            <p>You agree NOT to use the Service to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Send spam, unsolicited messages, or violate WhatsApp&rsquo;s policies</li>
              <li>Send misleading, fraudulent, or illegal content</li>
              <li>Harass, abuse, or harm other persons</li>
              <li>Violate intellectual property rights</li>
              <li>Reverse engineer, decompile, or attempt to extract source code</li>
              <li>Use the Service for any unlawful purpose</li>
            </ul>
            <p>
              We reserve the right to suspend or terminate accounts that violate
              these rules.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              5. Third-Party Services
            </h2>
            <p>
              The Service integrates with third-party providers including:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Meta WhatsApp Cloud API</strong> — Subject to{' '}
                <a
                  href="https://www.whatsapp.com/legal/business-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 underline"
                >
                  WhatsApp Business Policy
                </a>
              </li>
              <li>
                <strong>Google APIs</strong> — Subject to{' '}
                <a
                  href="https://developers.google.com/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 underline"
                >
                  Google APIs Terms of Service
                </a>
              </li>
              <li>
                <strong>OpenAI</strong> — Used for AI text generation
              </li>
              <li>
                <strong>PocketBase</strong> — Used for application data storage
              </li>
            </ul>
            <p>
              You are responsible for compliance with the terms of each
              third-party provider when using features that involve them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              6. Fees and Payment
            </h2>
            <p>
              The platform build is offered as a one-time fee per the
              quotation. Running costs (WhatsApp messaging fees to Meta and AI
              processing fees to OpenAI) are billed by those providers directly
              and are the customer&rsquo;s responsibility.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              7. Intellectual Property
            </h2>
            <p>
              The platform, source code, design, and underlying technology are
              the intellectual property of CodeSphere Agency LLP. Content you
              upload (business information, customer data, AI training material)
              remains yours.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              8. AI-Generated Content
            </h2>
            <p>
              The Service uses AI to generate replies, posts, and marketing
              content. While we work to ensure quality, AI output may
              occasionally be inaccurate. You are responsible for reviewing AI
              output before publishing or sending to customers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              9. Service Availability
            </h2>
            <p>
              We strive for high availability but do not guarantee uninterrupted
              service. Scheduled maintenance, third-party outages, and force
              majeure events may cause temporary interruptions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              10. Limitation of Liability
            </h2>
            <p>
              To the maximum extent permitted by law, CodeSphere Agency LLP
              shall not be liable for any indirect, incidental, special, or
              consequential damages arising from your use of the Service. Our
              total liability shall not exceed the fees paid by you in the
              preceding 12 months.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              11. Indemnification
            </h2>
            <p>
              You agree to indemnify and hold harmless CodeSphere Agency LLP
              from any claims, damages, or expenses arising from your misuse of
              the Service or violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              12. Termination
            </h2>
            <p>
              You may terminate your account at any time by contacting us. We
              may suspend or terminate your account if you violate these Terms.
              Upon termination, your access ends immediately and your data is
              deleted per our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              13. Changes to Terms
            </h2>
            <p>
              We may modify these Terms at any time. Continued use of the
              Service after changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              14. Governing Law
            </h2>
            <p>
              These Terms are governed by the laws of India. Any disputes shall
              be resolved in the courts of Maharashtra, India.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              15. Contact Us
            </h2>
            <p>
              For questions about these Terms, contact:
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

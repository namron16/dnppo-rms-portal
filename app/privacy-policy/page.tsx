'use client'
import { useState } from "react";


const sections = [
  {
    id: 1,
    title: "Identity of the Personal Information Controller",
    content: (
      <div className="space-y-3">
        <p>The Personal Information Controller (PIC) for data processed through the PNP-RMS is:</p>
        <div className="info-card">
          <p className="font-semibold">Davao Norte Police Provincial Office (DNPPO)</p>
          <p>National Highway, Visayan Village, Tagum City, Davao Del Norte</p>
          <p>Philippine National Police</p>
        </div>
        <div className="info-card mt-3">
          <p className="label">Designated Data Protection Officer (DPO)</p>
          <p>Email: <span className="placeholder">[Insert Official DPO Email Address]</span></p>
          <p>Hotline: <span className="placeholder">[Insert Official Contact Number]</span></p>
        </div>
      </div>
    ),
  },
  {
    id: 2,
    title: "Legal Basis for Processing",
    content: (
      <div className="space-y-3">
        <p>The PNP-RMS processes personal data on the following legal grounds:</p>
        <div className="list-items">
          {[
            { label: "Legal Mandate", desc: "Performance of official law enforcement, public safety, and administrative functions mandated to the PNP under R.A. 6975 and R.A. 8551." },
            { label: "Legal Obligation", desc: "Processing necessary for compliance with legal obligations, including audit, archiving, and records retention requirements of the National Archives of the Philippines (NAP)." },
            { label: "Consent", desc: "Processing expressly authorized by the data subject as a condition of system access and use." },
            { label: "Law Enforcement Exemption", desc: "Pursuant to Section 4 of R.A. 10173, certain processing activities related to law enforcement functions are exempt from specific DPA requirements, subject to the minimum necessary standard." },
          ].map((item, i) => (
            <div key={i} className="list-item">
              <span className="badge">{item.label}</span>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 3,
    title: "Categories of Personal Data Collected",
    content: (
      <div className="space-y-3">
        <p>The PNP-RMS collects and processes the following categories of data depending on the user's role and module accessed:</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data Category</th>
                <th>Examples</th>
                <th>Processing Purpose</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Identity and Authentication Data", "Full name, assigned role, employee serial number, login credentials (hashed), session tokens", "System access, authentication, and audit trail"],
                ["Personnel Records (201 Files)", "Personal Data Sheet (PDS), service records, promotions, commendations, disciplinary actions, biometric and identification data", "Personnel administration; P1 module only"],
                ["Document Metadata", "Upload timestamps, file names, file types, document titles, categories, tags, version history", "Records lifecycle management and search"],
                ["Classified and Operational Records", "Restricted and confidential documents, intelligence reports, operational case files", "Law enforcement and intelligence functions; P2 module only"],
                ["System Activity Logs", "Login/logout timestamps, IP addresses, actions performed, session duration", "Security auditing, compliance, and accountability"],
                ["Cloud Storage Metadata", "Google Drive file identifiers, storage pool assignments, file size, MIME type, access URLs", "File retrieval, storage management, and backup"],
              ].map(([cat, ex, purpose], i) => (
                <tr key={i}>
                  <td className="cat-cell">{cat}</td>
                  <td>{ex}</td>
                  <td>{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">The system does not collect data beyond what is necessary for the performance of official PNP functions. Sensitive personal information is accessible only to the P1 role.</p>
      </div>
    ),
  },
  {
    id: 4,
    title: "Purpose and Scope of Data Processing",
    content: (
      <ul className="bullet-list">
        {[
          "Management and storage of official records, documents, and communications within the DNPPO and its subordinate units.",
          "Administration and maintenance of personnel records in compliance with PNP policies and standards.",
          "Authentication, authorization, and session management for secure system access.",
          "Audit trail generation to support accountability, compliance reviews, and disciplinary proceedings.",
          "Automated backup and disaster recovery to ensure the continuity and integrity of official records.",
          "Inter-departmental document routing and workflow management.",
        ].map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    ),
  },
  {
    id: 5,
    title: "Data Storage and Security",
    content: (
      <div className="space-y-4">
        {[
          { sub: "5.1 Cloud Storage", text: "All uploaded files and documents are stored within a multi-account Google Drive pooling system administered by the DNPPO. Storage is partitioned per user role to prevent cross-user data access. Files are organized into category-specific folders within a dedicated root directory labelled 'DNPPO RMS' in each connected Google Drive account." },
          { sub: "5.2 Database Security", text: "Document metadata, user profiles, audit logs, and system configuration data are stored in a Supabase PostgreSQL database secured with row-level security (RLS) policies. Each database table enforces role-specific access rules, ensuring that users can only interact with records within their authorized scope." },
          { sub: "5.3 Encryption", text: null },
          { sub: "5.4 Audit Logging", text: "All user actions within the system — including login, logout, document uploads, edits, archiving, deletions, and document forwarding — are captured in an immutable audit log. Logs are retained for a minimum of ninety (90) days and are accessible exclusively to the Super Administrator role." },
        ].map((s, i) => (
          <div key={i}>
            <p className="sub-heading">{s.sub}</p>
            {s.text ? <p>{s.text}</p> : (
              <ul className="bullet-list">
                <li>Backup archives: AES-256-GCM encryption. Classified document backups are subject to double-layer encryption using a separate key.</li>
                <li>OAuth2 refresh tokens and access tokens for Google Drive accounts: AES-256-GCM encryption before database storage.</li>
                <li>Data in transit: All communications between the system and external services are secured via HTTPS/TLS.</li>
              </ul>
            )}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 6,
    title: "Data Sharing and Disclosure",
    content: (
      <div className="space-y-3">
        <p>Personal data processed within the PNP-RMS is not shared with external third parties for commercial, marketing, or non-official purposes. Data may be disclosed only in the following circumstances:</p>
        <ul className="bullet-list">
          <li>To other authorized PNP offices or units in the performance of official law enforcement or administrative functions.</li>
          <li>To the National Privacy Commission, the Ombudsman, or other oversight bodies upon lawful order or request.</li>
          <li>To courts or other judicial or quasi-judicial bodies in connection with pending legal proceedings.</li>
          <li>To Google LLC, solely to the extent necessary for the provision of Google Drive cloud storage services. No document content is analyzed or processed by Google for purposes other than storage and retrieval.</li>
        </ul>
        <p className="note">The system does not use third-party advertising services, analytics trackers, or data brokers.</p>
      </div>
    ),
  },
  {
    id: 7,
    title: "Data Retention and Disposal",
    content: (
      <div className="space-y-3">
        <ul className="bullet-list">
          <li><strong>Personnel 201 Files:</strong> Retained for the duration of active service plus fifteen (15) years from the date of separation. Records exceeding this period are automatically flagged for archiving.</li>
          <li><strong>Administrative and Operational Documents:</strong> Retained for the duration of the relevant operational need, subject to applicable NAP archiving standards.</li>
          <li><strong>System Audit Logs:</strong> Retained for a minimum of ninety (90) days. Logs related to pending investigations or legal proceedings are retained for the duration of those proceedings.</li>
          <li><strong>Backup Archives:</strong> Retained per the backup retention schedule configured by the Super Administrator, with a default of ninety (90) days.</li>
        </ul>
        <p>Upon expiration of the applicable retention period, records shall be securely archived, anonymized, or disposed of in a manner that prevents reconstruction, in compliance with NAP standards and PNP directives.</p>
      </div>
    ),
  },
  {
    id: 8,
    title: "Rights of Data Subjects",
    content: (
      <div className="space-y-3">
        <p>Where applicable under R.A. 10173, and subject to lawful limitations, data subjects have the following rights:</p>
        <div className="rights-grid">
          {[
            { right: "Right to be Informed", desc: "Be informed of the personal data being processed and the purposes thereof." },
            { right: "Right of Access", desc: "Request access to personal data held by the PNP-RMS." },
            { right: "Right to Rectification", desc: "Request correction of inaccurate, incomplete, or outdated personal data." },
            { right: "Right to Erasure / Blocking", desc: "Request the erasure or blocking of personal data whose processing violates R.A. 10173." },
            { right: "Right to Data Portability", desc: "Receive personal data in a structured, commonly used, and machine-readable format, where technically feasible." },
            { right: "Right to Object", desc: "Object to the processing of personal data, particularly where processing is based on legitimate interest." },
          ].map((r, i) => (
            <div key={i} className="right-card">
              <p className="right-title">{r.right}</p>
              <p>{r.desc}</p>
            </div>
          ))}
        </div>
        <p className="note">These rights may be exercised by submitting a written request to the designated Data Protection Officer. Note that certain rights may be subject to limitations where the processing is required for law enforcement purposes under Section 4 of R.A. 10173.</p>
      </div>
    ),
  },
  {
    id: 9,
    title: "Cookies and Session Management",
    content: (
      <p>The PNP-RMS uses server-side session cookies to maintain authenticated user sessions. These cookies are HttpOnly, SameSite=Lax, and secure in production environments. Session tokens are not shared with third parties and are invalidated upon logout. The system does not use tracking cookies, advertising cookies, or any form of cross-site analytics.</p>
    ),
  },
  {
    id: 10,
    title: "Changes to This Privacy Policy",
    content: (
      <p>This Privacy Policy may be updated periodically to reflect changes in applicable law, NPC issuances, or system functionality. All revisions will be communicated to users through official channels. The current version will always be available within the system. Continued use of the PNP-RMS following notification of a revision constitutes acceptance of the updated policy.</p>
    ),
  },
  {
    id: 11,
    title: "Contact the Data Protection Officer",
    content: (
      <div className="info-card">
        <p className="font-semibold">Data Protection Officer (DPO)</p>
        <p>Davao Norte Police Provincial Office (DNPPO)</p>
        <p>National Highway, Visayan Village, Tagum City, Davao Del Norte</p>
        <p>Email: <span className="placeholder">[Insert Official DPO Email Address]</span></p>
        <p>Hotline: <span className="placeholder">[Insert Official Contact Number]</span></p>
      </div>
    ),
  },
];

export default function PrivacyPolicy() {
  const [activeSection, setActiveSection] = useState<number | null>(null);

  const toggle = (id: number) => setActiveSection(activeSection === id ? null : id);

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'Georgia', 'Times New Roman', serif;
          background: #f4f1eb;
          color: #1a1a2e;
          min-height: 100vh;
        }

        .page-wrapper {
          max-width: 900px;
          margin: 0 auto;
          padding: 40px 24px 80px;
        }

        /* Header */
        .doc-header {
          border-top: 5px solid #0a2463;
          padding-top: 28px;
          margin-bottom: 40px;
        }

        .doc-header .agency-line {
          font-size: 11px;
          font-family: 'Arial', sans-serif;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: #c0392b;
          font-weight: 700;
          margin-bottom: 8px;
        }

        .doc-header h1 {
          font-size: 32px;
          font-weight: 700;
          color: #0a2463;
          line-height: 1.2;
          margin-bottom: 6px;
          letter-spacing: -0.5px;
        }

        .doc-header .system-name {
          font-size: 14px;
          color: #555;
          font-family: 'Arial', sans-serif;
          margin-bottom: 16px;
        }

        .meta-strip {
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
          font-size: 12px;
          font-family: 'Arial', sans-serif;
          color: #666;
          border-top: 1px solid #ddd;
          padding-top: 12px;
        }

        .meta-strip span {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .meta-dot {
          width: 6px;
          height: 6px;
          background: #c0392b;
          border-radius: 50%;
          display: inline-block;
        }

        /* Intro */
        .intro-box {
          background: #0a2463;
          color: #e8edf7;
          padding: 20px 24px;
          border-radius: 4px;
          font-size: 14px;
          line-height: 1.7;
          margin-bottom: 32px;
          font-family: 'Arial', sans-serif;
          border-left: 4px solid #c0392b;
        }

        /* Accordion */
        .section-item {
          border-bottom: 1px solid #d4cfc5;
          margin-bottom: 2px;
        }

        .section-btn {
          width: 100%;
          background: none;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 0;
          text-align: left;
          gap: 12px;
        }

        .section-btn:hover .section-title {
          color: #c0392b;
        }

        .section-num {
          font-size: 11px;
          font-family: 'Arial', sans-serif;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: #c0392b;
          min-width: 28px;
        }

        .section-title {
          font-size: 16px;
          font-weight: 700;
          color: #0a2463;
          flex: 1;
          transition: color 0.2s;
          font-family: 'Georgia', serif;
        }

        .chevron {
          font-size: 18px;
          color: #999;
          transition: transform 0.2s;
          flex-shrink: 0;
        }

        .chevron.open {
          transform: rotate(180deg);
          color: #c0392b;
        }

        .section-body {
          padding: 0 0 20px 40px;
          font-size: 14px;
          line-height: 1.75;
          color: #333;
          font-family: 'Arial', sans-serif;
          animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Inner components */
        .space-y-3 > * + * { margin-top: 12px; }
        .space-y-4 > * + * { margin-top: 16px; }

        .info-card {
          background: #eef1f8;
          border-left: 3px solid #0a2463;
          padding: 14px 16px;
          border-radius: 2px;
          line-height: 1.7;
        }

        .info-card .font-semibold { font-weight: 700; color: #0a2463; }
        .placeholder { color: #999; font-style: italic; }
        .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; font-weight: 700; margin-bottom: 4px; }

        .list-items { display: flex; flex-direction: column; gap: 10px; }

        .list-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 12px;
          background: #faf9f6;
          border: 1px solid #e0dbd0;
          border-radius: 3px;
        }

        .badge {
          display: inline-block;
          background: #0a2463;
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          padding: 2px 8px;
          border-radius: 2px;
          width: fit-content;
          margin-bottom: 2px;
        }

        .table-wrap { overflow-x: auto; }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        thead tr {
          background: #0a2463;
          color: #fff;
        }

        th {
          padding: 10px 12px;
          text-align: left;
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 0.04em;
        }

        td {
          padding: 10px 12px;
          border-bottom: 1px solid #e5e0d5;
          vertical-align: top;
        }

        tbody tr:nth-child(even) { background: #f7f5f0; }
        tbody tr:hover { background: #eef1f8; }

        .cat-cell { font-weight: 700; color: #0a2463; }

        .note {
          background: #fef9e7;
          border-left: 3px solid #f39c12;
          padding: 10px 14px;
          font-size: 13px;
          color: #555;
          border-radius: 2px;
        }

        .bullet-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .bullet-list li {
          padding-left: 18px;
          position: relative;
        }

        .bullet-list li::before {
          content: '—';
          position: absolute;
          left: 0;
          color: #c0392b;
          font-weight: 700;
        }

        .sub-heading {
          font-weight: 700;
          color: #0a2463;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
          font-family: 'Arial', sans-serif;
        }

        .rights-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        @media (max-width: 600px) {
          .rights-grid { grid-template-columns: 1fr; }
        }

        .right-card {
          background: #faf9f6;
          border: 1px solid #ddd;
          border-top: 3px solid #0a2463;
          padding: 12px;
          border-radius: 2px;
        }

        .right-title {
          font-weight: 700;
          color: #0a2463;
          font-size: 13px;
          margin-bottom: 4px;
        }

        /* Footer */
        .doc-footer {
          margin-top: 48px;
          border-top: 2px solid #0a2463;
          padding-top: 16px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 11px;
          font-family: 'Arial', sans-serif;
          color: #666;
          letter-spacing: 0.04em;
        }

        .footer-badge {
          background: #c0392b;
          color: #fff;
          padding: 3px 10px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          border-radius: 2px;
        }
      `}</style>

      <div className="page-wrapper">
        {/* Header */}
        <div className="doc-header">
          <p className="agency-line">Philippine National Police — Davao Norte Police Provincial Office</p>
          <h1>Privacy Policy</h1>
          <p className="system-name">PNP Records Management System (PNP-RMS)</p>
          <div className="meta-strip">
            <span><span className="meta-dot" /> Effective Date: Upon System Turnover</span>
            <span><span className="meta-dot" /> Version: 1.0</span>
            <span><span className="meta-dot" /> Governed by R.A. 10173 — Data Privacy Act of 2012</span>
          </div>
        </div>

        {/* Intro */}
        <div className="intro-box">
          The Davao Norte Police Provincial Office (DNPPO) of the Philippine National Police (PNP) is committed to protecting the personal data of all individuals whose information is processed within the PNP-RMS. This Privacy Policy explains what data we collect, why we collect it, how it is stored and protected, who may access it, and the rights of data subjects under Republic Act No. 10173, the Data Privacy Act of 2012.
        </div>

        {/* Accordion Sections */}
        <div>
          {sections.map((sec) => (
            <div key={sec.id} className="section-item">
              <button className="section-btn" onClick={() => toggle(sec.id)}>
                <span className="section-num">{String(sec.id).padStart(2, "0")}</span>
                <span className="section-title">{sec.title}</span>
                <span className={`chevron ${activeSection === sec.id ? "open" : ""}`}>▾</span>
              </button>
              {activeSection === sec.id && (
                <div className="section-body">{sec.content}</div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="doc-footer">
          <div>
            <p>PNP-RMS Privacy Policy — Version 1.0</p>
            <p>Davao Norte Police Provincial Office</p>
          </div>
          <span className="footer-badge">For Official Use Only</span>
        </div>
      </div>
    </>
  );
}
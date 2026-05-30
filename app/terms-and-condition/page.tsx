'use client'

import { useState } from "react";

const sections = [
  {
    id: 1,
    title: "Acceptance of Terms",
    content: (
      <div className="space-y-3">
        <p>By logging into and utilizing the PNP-RMS, you confirm that you have read, understood, and expressly agree to:</p>
        <ul className="bullet-list">
          <li>These Terms and Conditions</li>
          <li>The provisions of R.A. 10173 (DPA) and its Implementing Rules and Regulations (IRR)</li>
          <li>All relevant PNP memorandum circulars and administrative orders</li>
          <li>Any subsequent amendments issued by the National Privacy Commission (NPC) or the PNP</li>
        </ul>
        <div className="note">
          Access to this system constitutes a continuous affirmation of these terms. If you do not agree to any provision herein, you must immediately discontinue use of the system and notify your designated Data Protection Officer (DPO).
        </div>
      </div>
    ),
  },
  {
    id: 2,
    title: "System Overview and Scope",
    content: (
      <div className="space-y-4">
        <p>The PNP-RMS is a centralized digital records management platform designed to automate and secure the full lifecycle of police records, administrative files, classified documents, and internal communications. Deployed for use by the Davao Norte Police Provincial Office (DNPPO) and its subordinate units.</p>

        {[
          {
            sub: "2.1 Document Lifecycle Management",
            items: [
              { label: "Uploading", desc: "Uploading and ingestion of digital files, memoranda, circulars, reports, and official directives into the secure records database." },
              { label: "Cross-Referencing", desc: "Attachment and cross-referencing of related documents to create an interconnected audit trail for comprehensive case and records tracking." },
              { label: "Archiving", desc: "Long-term preservation of inactive records in compliance with the standards of the National Archives of the Philippines (NAP), including both automated and manual archiving workflows." },
              { label: "Editing and Modification", desc: "Controlled modification of existing records by authorized personnel, subject to full audit logging and version control that preserves the original file and all changes." },
            ],
          },
        ].map((mod, i) => (
          <div key={i}>
            <p className="sub-heading">{mod.sub}</p>
            <div className="list-items">
              {mod.items.map((item, j) => (
                <div key={j} className="list-item">
                  <span className="badge">{item.label}</span>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div>
          <p className="sub-heading">2.2 Personnel Records Management — P1 Exclusive</p>
          <p>The system maintains a secure digital 201 File repository for all PNP personnel, covering Personal Data Sheets (PDS), service records, promotion histories, commendations, and disciplinary actions.</p>
          <ul className="bullet-list mt-2">
            <li>Management of 201 Files is strictly exclusive to P1 (Personnel and Administrative Section). Only accounts assigned the P1 role may upload, edit, archive, view, or perform any action on personnel records within this module.</li>
            <li>All other staff roles — P2 through P10, WCPD, and PPSMU — are barred from accessing the Personnel 201 File module in any capacity.</li>
          </ul>
        </div>

        <div>
          <p className="sub-heading">2.3 Classified Documents — P2 Exclusive</p>
          <p>The Classified Documents module stores sensitive, restricted, and confidential records requiring heightened access controls.</p>
          <ul className="bullet-list mt-2">
            <li>All operations within this module — uploading, viewing, editing, archiving, and printing — are strictly exclusive to P2 (Intelligence Section).</li>
            <li>No other role may access, view, or interact with classified documents, regardless of rank or assignment.</li>
          </ul>
        </div>

        <div>
          <p className="sub-heading">2.4 Inter-Departmental Document Routing</p>
          <p>The system provides an automated digital communication pipeline to eliminate manual paper distribution and bureaucratic delays.</p>
          <ul className="bullet-list mt-2">
            <li>Authorized roles (P1 through P10, WCPD, PPSMU) may forward official documents, case files, and memoranda to other sections or units digitally.</li>
            <li>Real-time tracking of document workflow status (Pending, Saved, Dismissed) provides an electronic accountability log for the receiving officer or department.</li>
            <li>DPDA and DPDO accounts may review forwarded documents and route them back to the originating section. They may not upload, modify, or delete records.</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: 3,
    title: "Role-Based Access Control (RBAC)",
    content: (
      <div className="space-y-3">
        <p>Access within the PNP-RMS is governed by a strict role-based access control framework. Each account is assigned a fixed system role at provisioning. Roles cannot be self-modified.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role / Account</th>
                <th>Permitted Actions and Access Scope</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Super Administrator (admin)", "Full system administration: manage Google Drive accounts, user account credentials, log history, and backup and recovery operations. Does not access document content."],
                ["DPDA / DPDO", "View-only access to all document modules. May review forwarded documents and return them to the originating section. Cannot upload, modify, or delete documents."],
                ["P1 — Personnel and Administrative Section", "Full document operations on all modules plus exclusive access to the Personnel 201 File module. May upload, edit, archive, and forward documents."],
                ["P2 — Intelligence Section", "Full document operations on all general modules. Exclusive access to the Classified Documents module. Cannot access Personnel 201 Files."],
                ["P3 – P10, WCPD, PPSMU", "Upload, edit, archive, and forward documents within their designated modules. No access to Personnel 201 Files or Classified Documents."],
              ].map(([role, scope], i) => (
                <tr key={i}>
                  <td className="cat-cell">{role}</td>
                  <td>{scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note">Any attempt to access data, modules, or functions beyond the scope defined for your assigned role constitutes unauthorized access and is subject to disciplinary and legal action as outlined in Section 8.</div>
      </div>
    ),
  },
  {
    id: 4,
    title: "Storage and File Management",
    content: (
      <div className="space-y-3">
        <p>The PNP-RMS utilizes a multi-account Google Drive pooling system as its primary cloud storage infrastructure. The following provisions apply:</p>
        <ul className="bullet-list">
          <li>All uploaded files are stored in Google Drive accounts managed and controlled by the implementing agency. Files are organized into category-specific folders and are subject to access controls consistent with user roles.</li>
          <li>The system enforces a maximum file size limit of <strong>50 MB per upload</strong>. Accepted file formats are limited to: PDF, DOCX, XLSX, DOC, XLS, and common image formats (JPEG, PNG, etc.).</li>
          <li>Each user account's storage is scoped to that user's provisioned Google Drive accounts. The system is designed to prevent cross-user data routing.</li>
          <li>Google Drive accounts connected to the system are administered exclusively by the Super Administrator role. Users are prohibited from directly accessing, modifying, or disconnecting Drive accounts through any means outside the system.</li>
          <li>Backup of all system data and files is performed automatically on a configurable schedule (daily, weekly, monthly, yearly) and may also be triggered manually by the Super Administrator. Backup archives are <strong>AES-256 encrypted</strong>.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 5,
    title: "Data Privacy and Compliance",
    content: (
      <div className="space-y-4">
        <div>
          <p className="sub-heading">5.1 Governing Law</p>
          <p>The PNP-RMS and its operations are governed by Republic Act No. 10173, otherwise known as the Data Privacy Act of 2012, its Implementing Rules and Regulations, and all circulars and issuances of the National Privacy Commission (NPC).</p>
        </div>
        <div>
          <p className="sub-heading">5.2 Law Enforcement Exemptions</p>
          <p>Pursuant to Section 4 of the Data Privacy Act of 2012, information necessary for the prevention, investigation, prosecution, and other law enforcement functions of public authorities is exempt from the full application of the DPA, provided that processing is strictly limited to the minimum necessary to fulfill the PNP's mandated functions. This exemption does not override the security, audit, and confidentiality obligations imposed upon all system users under these Terms.</p>
        </div>
        <div>
          <p className="sub-heading">5.3 Data Processing Principles</p>
          <div className="list-items">
            {[
              { label: "Transparency", desc: "Data subjects will be informed of the nature, scope, and purpose of data processing. Consent, where required, shall be obtained prior to collection." },
              { label: "Legitimate Purpose", desc: "Processing is strictly limited to purposes related to law enforcement, public safety, internal administration, and official PNP functions." },
              { label: "Proportionality", desc: "Only data that is necessary for the declared purpose shall be collected, retained, and processed." },
            ].map((item, i) => (
              <div key={i} className="list-item">
                <span className="badge">{item.label}</span>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="sub-heading">5.4 Security Measures</p>
          <ul className="bullet-list">
            <li>AES-256-GCM encryption for all backup archives and classified document exports.</li>
            <li>Role-based access control (RBAC) enforced at both the application and database levels, including row-level security (RLS) on all document tables.</li>
            <li>Comprehensive and immutable audit logging of all user actions, including login, logout, upload, edit, archive, delete, and document forwarding events.</li>
            <li>Session management controls, including single active session enforcement per role to prevent concurrent unauthorized access.</li>
            <li>Automatic account lockout and administrator notification upon detection of policy violations or suspicious activity.</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: 6,
    title: "User Obligations and Responsibilities",
    content: (
      <div className="list-items">
        {[
          { label: "Confidentiality", desc: "All information accessed through the PNP-RMS — regardless of classification level — must be treated as strictly confidential. Unauthorized disclosure, distribution, or reproduction of system data in any form is prohibited." },
          { label: "Authorized Access Only", desc: "Users shall only access records, modules, and functions directly relevant to their current official assignment. Accessing records outside the scope of one's role or duty — including curiosity searching — constitutes a severe violation." },
          { label: "Data Integrity", desc: "All data submitted, encoded, or modified by users must be accurate, factual, and complete. Deliberate falsification or distortion of records is grounds for criminal and administrative action." },
          { label: "Audit and Monitoring", desc: "All system activities — including login, document access, edits, exports, and forwarding events — are continuously tracked and logged. Users consent to this monitoring as a condition of system access." },
          { label: "Credential Security", desc: "Users must safeguard their login credentials at all times. Sharing of passwords or access tokens is strictly prohibited. Users are fully accountable for all actions performed under their credentials." },
          { label: "Incident Reporting", desc: "Users must immediately report any suspected security incident, unauthorized access, or data breach to the designated DPO." },
        ].map((item, i) => (
          <div key={i} className="list-item">
            <span className="badge">{item.label}</span>
            <p>{item.desc}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 7,
    title: "Data Retention and Disposal",
    content: (
      <div className="space-y-3">
        <ul className="bullet-list">
          <li><strong>Active Records:</strong> Retained for the duration of the operational or investigative need for which they were created.</li>
          <li><strong>Personnel 201 Files:</strong> Retained for the duration of active service plus fifteen (15) years following separation. Records exceeding this retention period are automatically flagged for archiving by the system.</li>
          <li><strong>Administrative Logs and Audit Trails:</strong> Retained for a minimum of ninety (90) days. Extended retention may be mandated by ongoing investigations or legal proceedings.</li>
          <li><strong>Upon Expiration:</strong> Records shall be securely archived or — where legally permissible — anonymized or disposed of in a manner that prevents reconstruction.</li>
        </ul>
        <p className="note">All retention and disposal actions are subject to compliance with the National Archives of the Philippines (NAP) standards and applicable PNP memorandum circulars.</p>
      </div>
    ),
  },
  {
    id: 8,
    title: "Prohibited Acts and Penalties",
    content: (
      <div className="space-y-3">
        <p>The following acts are strictly prohibited and shall be dealt with accordingly under applicable law and PNP administrative regulations:</p>
        <ul className="bullet-list">
          <li>Unauthorized access to, disclosure, or processing of records within the system.</li>
          <li>Sharing, replication, or exfiltration of system data without proper authorization.</li>
          <li>Tampering, falsification, deletion, or destruction of records.</li>
          <li>Circumventing or disabling any security feature, access control, or audit mechanism.</li>
          <li>Using the system for any purpose other than the official discharge of duties.</li>
        </ul>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Offense</th>
                <th>Governing Regulation / Penalty</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Unauthorized Access or Processing", "Sections 25 and 29, R.A. 10173 — Imprisonment up to six (6) years and fines up to ₱5,000,000"],
                ["Breach of Confidentiality", "R.A. 3019, Anti-Graft and Corrupt Practices Act — Criminal liability and administrative sanctions"],
                ["Administrative Infractions", "RRACCS and PNP Disciplinary Machinery (NAPOLCOM) — Suspension, dismissal, or other administrative penalties"],
                ["Malicious Data Tampering or Destruction", "R.A. 10175, Cybercrime Prevention Act of 2012 — Imprisonment and fines commensurate to severity"],
              ].map(([offense, penalty], i) => (
                <tr key={i}>
                  <td className="cat-cell">{offense}</td>
                  <td>{penalty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ),
  },
  {
    id: 9,
    title: "Backup, Recovery, and System Continuity",
    content: (
      <div className="space-y-3">
        <p>The PNP-RMS incorporates an integrated backup and recovery system managed exclusively by the Super Administrator account. The following provisions govern its use:</p>
        <ul className="bullet-list">
          <li>Automated backups are executed on a configurable schedule across all modules, including Master Documents, Admin Orders, Daily Journals, E-Library, Personnel 201 Files, Classified Documents, and administrative logs.</li>
          <li>All backup archives are encrypted using AES-256-GCM. Classified document backups undergo an additional layer of encryption.</li>
          <li>Recovery operations may only be initiated by the Super Administrator and require explicit confirmation. Recovery procedures are logged and audited.</li>
          <li>Backup integrity is verified using SHA-256 checksums embedded in a signed manifest file. Any manifest tampering is detected automatically and will abort the recovery process.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 10,
    title: "Amendments to These Terms",
    content: (
      <p>The PNP reserves the right to amend, revise, or update these Terms and Conditions at any time, in response to new legislation, NPC circulars, operational requirements, or system upgrades. All amendments will be communicated to users through official channels. Continued use of the system following notification of an amendment constitutes acceptance of the revised terms.</p>
    ),
  },
  {
    id: 11,
    title: "Contact Information — Data Protection Officer",
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

export default function TermsAndConditions() {
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
        .mt-2 { margin-top: 8px; }

        .info-card {
          background: #eef1f8;
          border-left: 3px solid #0a2463;
          padding: 14px 16px;
          border-radius: 2px;
          line-height: 1.7;
        }

        .info-card .font-semibold { font-weight: 700; color: #0a2463; }
        .placeholder { color: #999; font-style: italic; }

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
          <h1>Terms and Conditions</h1>
          <p className="system-name">PNP Records Management System (PNP-RMS)</p>
          <div className="meta-strip">
            <span><span className="meta-dot" /> Effective Date: Upon System Turnover</span>
            <span><span className="meta-dot" /> Version: 1.0</span>
            <span><span className="meta-dot" /> Governed by R.A. 10173 — Data Privacy Act of 2012</span>
          </div>
        </div>

        {/* Intro */}
        <div className="intro-box">
          Welcome to the PNP Records Management System (PNP-RMS). By accessing or using this system, you — the authorized user, referring to PNP personnel, designated government agents, or cleared data subjects — agree to be bound by the following Terms and Conditions. These terms govern access to and use of the system in full compliance with applicable Philippine law, including Republic Act No. 10173, otherwise known as the Data Privacy Act of 2012 (DPA).
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
            <p>PNP-RMS Terms and Conditions — Version 1.0</p>
            <p>Davao Norte Police Provincial Office</p>
          </div>
          <span className="footer-badge">For Official Use Only</span>
        </div>
      </div>
    </>
  );
}
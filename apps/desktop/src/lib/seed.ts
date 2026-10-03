import type { AppData, Job, Status, CalEvent, Credential, DocItem, Company } from "./types";
import { at, DAY } from "./format";
import { seedGate } from "./gate";

type JobRow = [string, string, string, string, Job["workMode"], string, number, Status, number | undefined, string | undefined, string];
// id, company, role, location, workMode, pay, score, status, dueOffsetDays, dueLabel, about
const rows: JobRow[] = [
  ["j6", "Notion", "Product Design Intern", "San Francisco, CA", "Remote", "$38–46/hr", 92, "saved", undefined, undefined, "Design flexible tools that help teams think, write and plan together."],
  ["j7", "Linear", "Product Engineering Intern", "Remote · US", "Remote", "$45–52/hr", 84, "saved", undefined, undefined, "Create focused tools that help product teams plan and ship quality software."],
  ["j8", "Figma", "Software Engineering Intern", "Remote · US", "Remote", "$42–50/hr", 92, "saved", undefined, undefined, "Build collaborative design and developer tools used by global product teams."],
  ["j9", "Anthropic", "Research Engineering Intern", "Remote · US", "Remote", "$48–58/hr", 81, "saved", undefined, undefined, "Support safe and useful AI research through production engineering."],
  ["j10", "Microsoft", "Product Manager Intern", "Seattle, WA", "Onsite", "$38–46/hr", 88, "preparing", 6, "Due", "Help deliver customer-focused product experiences at global scale."],
  ["j11", "Amazon", "Software Development Engineer Intern", "Remote · US", "Remote", "$40–48/hr", 85, "preparing", 8, "Due", "Build resilient services and customer experiences with a fast-moving team."],
  ["j12", "OpenAI", "Research Engineer Intern", "San Francisco, CA", "Onsite", "$52–62/hr", 90, "preparing", 10, "Due", "Collaborate with researchers and engineers on capable, safe AI systems."],
  ["j13", "Databricks", "Data Engineering Intern", "Remote · US", "Remote", "$40–48/hr", 82, "preparing", undefined, undefined, "Develop data products and platforms that help teams solve hard problems."],
  ["j14", "Google", "Software Engineering Intern", "Mountain View, CA", "Onsite", "$48–58/hr", 94, "applied", -5, "Applied", "Work with an engineering team on reliable, useful products for millions."],
  ["j15", "Stripe", "Technical Program Intern", "Remote · US", "Remote", "$44–54/hr", 86, "applied", -6, "Applied", "Coordinate technical work that increases the internet's economic infrastructure."],
  ["j16", "Netflix", "Data Science Intern", "Remote · US", "Remote", "$45–55/hr", 80, "applied", -7, "Applied", "Use data to improve how people discover and enjoy entertainment."],
  ["j17", "Uber", "Product Management Intern", "San Francisco, CA", "Onsite", "$40–50/hr", 78, "applied", -9, "Applied", "Shape product experiences for a global mobility platform."],
  ["j18", "Meta", "Product Management Intern", "Remote · US", "Remote", "$46–56/hr", 87, "interviewing", 1, "Round 2", "Help people connect through products used around the world."],
  ["j19", "Airbnb", "Backend Engineering Intern", "San Francisco, CA", "Onsite", "$43–53/hr", 89, "interviewing", 2, "Onsite", "Build trusted systems that support a global community of hosts and guests."],
  ["j20", "Snowflake", "Data Engineering Intern", "Remote · US", "Remote", "$42–52/hr", 84, "interviewing", 4, "Panel", "Build a dependable cloud data platform for teams everywhere."],
  ["j21", "Shopify", "Software Engineering Intern", "Remote · US", "Remote", "$40–48/hr", 86, "interviewing", 5, "Technical", "Create powerful tools that help entrepreneurs run their businesses."],
  ["j22", "Apple", "Software Engineering Intern", "Cupertino, CA", "Onsite", "$48–58/hr", 91, "offer", 3, "Offer", "Build exceptional experiences through thoughtful hardware and software engineering."],
  ["j23", "Canva", "Product Design Intern", "Remote · US", "Remote", "$38–46/hr", 83, "offer", 1, "Offer", "Make design accessible to everyone through simple, joyful tools."],
  ["j24", "Palantir", "Forward Deployed Engineering Intern", "New York, NY", "Onsite", "$45–55/hr", 77, "offer", 0, "Offer", "Deliver software directly alongside customers tackling complex missions."],
];

const SITE: Record<string, string> = {
  Google: "google.com", Microsoft: "microsoft.com", Amazon: "amazon.com", Stripe: "stripe.com", Notion: "notion.so", Airbnb: "airbnb.com",
  Meta: "meta.com", Netflix: "netflix.com", Apple: "apple.com", Linear: "linear.app", Figma: "figma.com", Anthropic: "anthropic.com",
  OpenAI: "openai.com", Databricks: "databricks.com", Uber: "uber.com", Snowflake: "snowflake.com", Shopify: "shopify.com", Canva: "canva.com",
  Palantir: "palantir.com", Spotify: "spotify.com",
};
const domainOf = (c: string) => SITE[c] ?? `${c.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;

const jobs = (): Job[] =>
  rows.map(([id, company, role, location, workMode, pay, score, status, due, dueLabel, about], i) => ({
    id, company, role, location, workMode, pay, score, status, about,
    track: role.includes("Product") ? "Product" : role.includes("Data") ? "Data" : role.includes("Research") ? "Research" : "Engineering",
    url: `https://careers.${domainOf(company)}`,
    addedAt: at(-(i % 6) - 1, 9 + (i % 8)),
    dueAt: due === undefined ? undefined : at(due, 9),
    dueLabel,
    notes: "",
    source: status === "pending_review" ? "agent" : "manual",
    eligibility: {
      f1: score % 2 ? "Eligible" : "Review", cpt: score % 2 ? "Possible" : "Unknown",
      citizen: false, usPerson: company === "Arcade Systems" || company === "Palantir", sponsorship: score % 3 ? "Not stated" : "Available",
    },
  }));

const companies = (): Company[] => {
  const info: Record<string, [string, string, string]> = {
    Google: ["Technology", "10,000+", "Mountain View, CA"], Microsoft: ["Technology", "10,000+", "Redmond, WA"], Amazon: ["E-commerce & Cloud", "10,000+", "Seattle, WA"],
    Stripe: ["Fintech", "5,000+", "San Francisco, CA"], Notion: ["Productivity", "500+", "San Francisco, CA"], Meta: ["Social & AI", "10,000+", "Menlo Park, CA"],
    Airbnb: ["Travel", "5,000+", "San Francisco, CA"], Apple: ["Consumer Technology", "10,000+", "Cupertino, CA"], Netflix: ["Entertainment", "10,000+", "Los Gatos, CA"],
    Figma: ["Design software", "1,000+", "San Francisco, CA"], Anthropic: ["AI research", "1,000+", "San Francisco, CA"], OpenAI: ["AI research", "1,000+", "San Francisco, CA"],
  };
  return [...new Set(rows.map((r) => r[1]))].map((name, i) => ({
    id: `c${i + 1}`, name, website: `https://${domainOf(name)}`, industry: info[name]?.[0] ?? "Technology", size: info[name]?.[1] ?? "1,000+", hq: info[name]?.[2] ?? "United States", notes: "",
  }));
};

const events = (): CalEvent[] => {
  const prep = (items: [string, boolean][]) => items.map(([text, done], i) => ({ id: `p${i}`, text, done }));
  const E = (id: string, title: string, company: string | undefined, kind: CalEvent["kind"], start: number, mins: number, format: CalEvent["format"], extra: Partial<CalEvent> = {}): CalEvent => ({
    id, title, company, kind, start, end: start + mins * 60000, format, description: "", notes: "", attendees: [], prep: [], ...extra,
  });
  return [
    E("e1", "Technical Round", "Google", "interview", at(1, 9), 60, "Video Call", {
      link: "https://meet.google.com/xyz-abc-def", jobId: "j14", description: "Technical interview focusing on data structures, algorithms, and system design basics.",
      attendees: [{ name: "You", role: "Candidate" }, { name: "Sarah Chen", role: "Recruiter" }],
      prep: prep([["Review data structures (arrays, trees, graphs)", true], ["Practice system design basics", true], ["Go over past interview questions", false], ["Prepare questions to ask", false], ["Test video/audio setup", false]]),
    }),
    E("e2", "Follow up", "Microsoft recruiter", "followup", at(1, 9, 30), 30, "None", { jobId: "j10" }),
    E("e3", "System Design Prep", undefined, "assessment", at(2, 9), 90, "None", { description: "Work through two system design prompts." }),
    E("e4", "Final Round", "Amazon", "interview", at(3, 9), 60, "In Person", { jobId: "j11", location: "Amazon HQ, Seattle", description: "Final onsite round with the hiring panel." }),
    E("e5", "Application Deadline", "Netflix", "deadline", at(1, 11), 30, "None", { jobId: "j16" }),
    E("e6", "Product Interview", "Stripe", "interview", at(2, 11), 60, "Video Call", {
      jobId: "j15", link: "https://stripe.com/meet/product", attendees: [{ name: "You", role: "Candidate" }, { name: "Alex Rivera", role: "Hiring Manager" }],
      prep: prep([["Research Stripe products", true], ["Prepare product teardown", false], ["Test video/audio setup", false]]),
    }),
    E("e7", "LeetCode Practice", undefined, "assessment", at(1, 13), 60, "None"),
    E("e8", "Follow up", "Airbnb", "followup", at(2, 13), 30, "None", { jobId: "j19" }),
    E("e9", "Behavioral Prep", undefined, "assessment", at(3, 13), 60, "None"),
    E("e10", "Culture Round", "Notion", "interview", at(1, 15), 60, "Video Call", { jobId: "j6", link: "https://meet.google.com/not-ion-rnd" }),
    E("e11", "Review Resume", undefined, "personal", at(2, 16), 60, "None"),
    E("e12", "Send thank you note", "Google", "followup", at(3, 16), 30, "None", { jobId: "j14" }),
    E("e13", "Panel Interview", "Snowflake", "interview", at(4, 10), 60, "Video Call", { jobId: "j20" }),
    E("e14", "Application Deadline", "Microsoft", "deadline", at(6, 23), 30, "None", { jobId: "j10" }),
  ];
};

const credentials = (): Credential[] => {
  const C = (portal: string, domain: string, type: Credential["type"], mfa: Credential["mfa"], jobIds: string[], lastDaysAgo: number, company?: string): Credential => ({
    id: `cr-${portal.toLowerCase().replace(/\W+/g, "-")}`, portal, domain, company, username: "charles@example.com", recoveryEmail: "", type, mfa, notes: "", jobIds,
    lastUsedAt: at(-lastDaysAgo), createdAt: at(-60), activity: [{ id: "a0", at: at(-60), action: "Created credential" }],
  });
  return [
    C("Google Careers", "careers.google.com", "Company", "authenticator", ["j14"], 3, "Google"),
    C("Microsoft Careers", "careers.microsoft.com", "Company", "authenticator", ["j10"], 5, "Microsoft"),
    C("Amazon Jobs", "hiring.amazon.com", "Company", "authenticator", ["j11"], 6, "Amazon"),
    C("Workday", "myworkday.com", "HR Platform", "authenticator", ["j20"], 8),
    C("Greenhouse", "app.greenhouse.io", "ATS", "none", ["j15", "j16", "j7", "j8"], 10),
    C("LinkedIn", "linkedin.com", "Social", "authenticator", [], 12),
    C("Stripe Jobs", "stripe.com/careers", "Company", "authenticator", ["j15"], 14, "Stripe"),
    C("Meta Careers", "metacareers.com", "Company", "none", ["j18"], 16, "Meta"),
    C("Indeed", "indeed.com", "Job Board", "authenticator", [], 20),
  ];
};

const doc = (id: string, name: string, ext: string, folder: string, kb: number, daysAgo: number, description: string, extra: Partial<DocItem> = {}): DocItem => ({
  id, name, description, ext, mime: ext === "PDF" ? "application/pdf" : ext === "DOCX" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream",
  folder, jobIds: [], tags: [folder.toLowerCase().replace(/s$/, "")], size: kb * 1024, createdAt: at(-daysAgo - 40), modifiedAt: at(-daysAgo, 14, 34),
  hasFile: false, currentVersion: "v1", versions: [{ id: "v1", at: at(-daysAgo - 40), size: kb * 1024, note: "Initial upload" }], ...extra,
});
const documents = (): DocItem[] => [
  doc("d1", "Resume - Software Engineer", "PDF", "Resumes", 345, 1, "Primary resume for general applications", { tags: ["resume", "software-engineer", "general"], jobIds: ["j14", "j11", "j8", "j7", "j19", "j21", "j8"] .filter((v, i, a) => a.indexOf(v) === i), versions: [{ id: "v1", at: at(-40), size: 330 * 1024, note: "Initial upload" }, { id: "v2", at: at(-12), size: 340 * 1024, note: "Updated projects" }, { id: "v3", at: at(-1), size: 345 * 1024, note: "Tailored summary" }], currentVersion: "v3" }),
  doc("d2", "Resume - Product Manager", "PDF", "Resumes", 320, 3, "Tailored for PM roles", { tags: ["resume", "product"], jobIds: ["j10", "j17", "j18"] }),
  doc("d3", "Cover Letter - Google", "DOCX", "Cover Letters", 124, 4, "Software Engineer role", { company: "Google", jobIds: ["j14"], tags: ["cover-letter", "google"] }),
  doc("d4", "Cover Letter - Microsoft", "DOCX", "Cover Letters", 118, 4, "Product Manager role", { company: "Microsoft", jobIds: ["j10"], tags: ["cover-letter", "microsoft"] }),
  doc("d5", "Portfolio", "PDF", "Portfolios", 2150, 8, "Selected work and case studies", { tags: ["portfolio"] }),
  doc("d6", "Projects Overview", "PDF", "Portfolios", 1434, 8, "Project highlights and links", { tags: ["portfolio", "projects"] }),
  doc("d7", "Transcript - University", "PDF", "Certificates", 890, 14, "Official academic transcript", { tags: ["transcript"] }),
  doc("d8", "Certificate - AWS Cloud Practitioner", "PDF", "Certificates", 420, 20, "AWS certification", { tags: ["certificate", "aws"] }),
  doc("d9", "Certificate - Machine Learning", "PDF", "Certificates", 380, 25, "Coursera certificate", { tags: ["certificate", "ml"] }),
  doc("d10", "Reference List", "DOCX", "Other", 90, 30, "Professional references", { tags: ["references"] }),
  doc("d11", "ID - Passport", "PDF", "Other", 1229, 40, "Identification document", { tags: ["id"] }),
  doc("d12", "Work Sample - Data Analysis", "PDF", "Company Specific", 2867, 45, "Sample analysis project", { company: "Amazon", jobIds: ["j11"], tags: ["work-sample", "amazon"] }),
  doc("d13", "Cover Letter - Amazon", "DOCX", "Cover Letters", 120, 45, "Data Scientist role", { company: "Amazon", jobIds: ["j11"], tags: ["cover-letter", "amazon"] }),
];

export function seed(): AppData {
  const now = Date.now();
  return {
    gate: seedGate(now),
    jobs: jobs(),
    companies: companies(),
    contacts: [
      { id: "ct1", name: "Sarah Chen", role: "Recruiter", company: "Google", email: "sarah.chen@example.com", phone: "", linkedin: "linkedin.com/in/sarahchen", jobId: "j14", lastContacted: at(-2) },
      { id: "ct2", name: "Alex Rivera", role: "Hiring Manager", company: "Stripe", email: "alex.rivera@example.com", phone: "", linkedin: "", jobId: "j15", lastContacted: at(-4) },
      { id: "ct3", name: "Priya Nair", role: "University Recruiter", company: "Meta", email: "priya.nair@example.com", phone: "", linkedin: "linkedin.com/in/priyanair", jobId: "j18", lastContacted: at(-1) },
    ],
    documents: documents(),
    folders: [],
    credentials: credentials(),
    events: events(),
    tasks: [
      { id: "t1", title: "Follow up with recruiter", company: "Google", subtitle: "Google · Software Engineering Intern", dueAt: at(0, 10), priority: "High", icon: "mail", done: false, jobId: "j14" },
      { id: "t2", title: "Prepare for technical interview", company: "Stripe", subtitle: "Stripe · Video Call", dueAt: at(0, 11), priority: "Today", icon: "calendar", done: false, jobId: "j15" },
      { id: "t3", title: "Send thank-you note", company: "Notion", subtitle: "Notion · Product Design Intern", dueAt: at(0, 14), priority: "Medium", icon: "send", done: false, jobId: "j6" },
      { id: "t4", title: "Review new jobs from agent", subtitle: "5 new matches available", dueAt: at(0, 16), priority: "Low", icon: "search", done: false },
    ],
    notifications: [
      { id: "n1", kind: "interview", title: "Interview Tomorrow", company: "Google", role: "Software Engineering Intern", body: "Your technical interview is scheduled for tomorrow.", at: at(0, 10, 24), read: false, chip: "Tomorrow", eventId: "e1", jobId: "j14" },
      { id: "n2", kind: "deadline", title: "Application Deadline Today", company: "Microsoft", role: "Product Manager Intern", body: "Application deadline is today at 11:59 PM.", at: at(0, 8, 42), read: false, chip: "Today", jobId: "j10" },
      { id: "n3", kind: "match", title: "New Job Matches Found", body: "Your AI agent found 5 new opportunities. Spotify +4 match your preferences.", at: at(0, 8, 15), read: false, chip: "New" },
      { id: "n4", kind: "recruiter", title: "Recruiter Replied", company: "Stripe", role: "Technical Program Intern", body: "Alex Rivera replied to your application email.", at: at(0, 7, 33), read: true, chip: "Replied", jobId: "j15" },
      { id: "n5", kind: "followup", title: "Follow-up Due", company: "Amazon", role: "Software Development Engineer Intern", body: "It's been 5 days since your interview. Consider sending a follow-up.", at: at(-1, 15, 10), read: true, chip: "Follow-up", jobId: "j11" },
      { id: "n6", kind: "document", title: "Missing Document", body: "Your resume is missing for 2 applications. Add your latest resume to complete these applications.", at: at(-1, 11), read: true, chip: "Action Needed" },
      { id: "n7", kind: "stale", title: "Stale Application Alert", company: "Meta", role: "Product Management Intern", body: "No activity for 14 days. Consider following up.", at: at(-1, 9), read: true, chip: "Stale", jobId: "j18" },
      { id: "n8", kind: "reminder", title: "Thank You Note Reminder", company: "Notion", role: "Product Design Intern", body: "Interviewed at Notion. Send a thank you note within 24 hours.", at: at(-2, 17), read: true, chip: "Reminder", jobId: "j6" },
      { id: "n9", kind: "weekly", title: "Weekly Review Reminder", body: "It's time for your weekly job search review. Review your progress, update your goals, and plan ahead.", at: at(-3, 9), read: true, chip: "Weekly" },
    ],
    inbox: [
      { id: "m1", kind: "research", icon: "sparkle", title: "New Job Matches Found", preview: "Found 5 new opportunities matching your preferences at Spotify, Notion +3", body: "I found 5 new job opportunities that match your preferences based on your profile, recent activity, and current market trends. These roles align well with your experience and are a good fit for your target companies and locations.", at: at(0, 10, 24), read: false, starred: false, gateMatches: ["gate-doordash-3536354", "gate-northstar-4411", "gate-atlas-9921", "gate-fjord-2208", "gate-spotify-7710"], cta: { label: "Open GATE Inbox", route: "gate" } },
      { id: "m2", kind: "applications", icon: "mail", title: "Application Submitted", preview: "Applied to Software Engineering Intern at Google", body: "Your application to Google (Software Engineering Intern) was recorded. I'll watch for recruiter replies and remind you to follow up in 5 days.", at: at(-1, 14), read: false, starred: false },
      { id: "m3", kind: "interviews", icon: "calendar", title: "Interview Scheduled", preview: "Google · Technical Round — tomorrow at 9:00 AM (Video Call)", body: "Your technical round with Google is on the calendar. I created a 5-step preparation checklist; two items are already done.", at: at(-1, 11), read: false, starred: false },
      { id: "m4", kind: "followups", icon: "doc", title: "Follow-up Reminder", preview: "It's been 5 days since your interview with Amazon. Suggested follow-up email.", body: "Subject: Following up on my interview\n\nHi team,\n\nThank you again for taking the time to speak with me last week. I'm still very excited about the Software Development Engineer Intern role and would love to hear about next steps.\n\nBest,\nCharles", at: at(-3, 9), read: false, starred: false },
      { id: "m5", kind: "research", icon: "bulb", title: "Company Research Update", preview: "New insights about Meta's product organization and team structure.", body: "Meta's product org is split into Family of Apps and Reality Labs. PM interns typically rotate through one pod with a strong data focus.", at: at(-4, 13), read: false, starred: false },
      { id: "m6", kind: "insights", icon: "chart", title: "Market Insight", preview: "Internship postings are up 23% this month in the Bay Area.", body: "Postings for software and product internships in the Bay Area grew 23% over the last 30 days. Now is a good time to apply to saved roles.", at: at(-5, 9), read: false, starred: false },
      { id: "m7", kind: "applications", icon: "doc", title: "Resume Feedback", preview: "Reviewed your resume for the Amazon application. 3 suggestions available.", body: "1. Lead with your strongest project.\n2. Quantify impact in the second bullet.\n3. Move coursework below experience.", at: at(-6, 16), read: false, starred: false },
      { id: "m8", kind: "alerts", icon: "alert", title: "Application Status Update", preview: "Your application at Netflix moved to \"Technical Interview\".", body: "Netflix updated your application status to Technical Interview. I added a prep task for you.", at: at(-7, 10), read: false, starred: false },
      { id: "m9", kind: "insights", icon: "sparkle", title: "Weekly Summary", preview: "You applied to 6 jobs, had 2 interviews, and received 3 new matches.", body: "This week: 6 applications, 2 interviews, 3 new matches. Response rate is up 8% versus last month.", at: at(-8, 9), read: false, starred: false },
    ],
    activity: [
      { id: "ac1", at: now - 2 * 3_600_000, icon: "doc", title: "Application submitted", subtitle: "Google · Software Engineering Intern" },
      { id: "ac2", at: now - 4 * 3_600_000, icon: "calendar", title: "Interview scheduled", subtitle: "Stripe · Product Interview" },
      { id: "ac3", at: now - 6 * 3_600_000, icon: "spark", title: "New job match", subtitle: "3 new opportunities from your agent" },
      { id: "ac4", at: now - 12 * 3_600_000, icon: "note", title: "Note added", subtitle: "Amazon · Added interview prep notes" },
      { id: "ac5", at: now - DAY, icon: "doc", title: "Resume updated", subtitle: "Updated resume v3.pdf" },
    ],
    settings: {
      profile: { name: "Charles A. Boakye", email: "charles@example.com", title: "Computer Science Student", location: "San Francisco, CA", phone: "+1 (415) 555-0133", linkedin: "linkedin.com/in/charles", website: "", bio: "Passionate about building scalable products and solving complex problems." },
      appearance: { theme: "light", density: "comfortable" },
      notify: { interviews: true, deadlines: true, followups: true, agent: true, system: true },
      prefs: { roles: "Software Engineering Intern, Product Intern", locations: "San Francisco, Remote, Hybrid", salary: "$38K – $60K", companies: "Top tech, startups, open to new", keywords: "Product, strategy, growth", level: "Internship" },
      agent: { active: true },
    },
  } as AppData;
}

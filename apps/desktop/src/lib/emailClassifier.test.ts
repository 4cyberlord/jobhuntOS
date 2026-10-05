import { describe, expect, it } from "vitest";
import { classifyEmail } from "./emailClassifier";

describe("email classifier", () => {
  it("recognizes common pipeline updates", () => {
    expect(classifyEmail({ subject: "Thank you for applying to Acme", from: "jobs@acme.com" }).label).toBe("application_confirmed");
    expect(classifyEmail({ subject: "Complete your HackerRank coding assessment", from: "notifications@hackerrank.com" }).label).toBe("assessment_invite");
    expect(classifyEmail({ subject: "Interview invitation", bodyPreview: "Please select a time for your interview" }).label).toBe("interview_invite");
    expect(classifyEmail({ subject: "An offer from Acme", bodyPreview: "We are pleased to offer you" }).label).toBe("offer");
    expect(classifyEmail({ subject: "Update on your application", bodyPreview: "we will not be moving forward" }).label).toBe("rejection");
  });

  it("does not treat generic mail as a pipeline update", () => {
    expect(classifyEmail({ subject: "Weekly engineering newsletter", bodyPreview: "Read our latest articles. Unsubscribe here." }).label).toBe("newsletter");
    expect(classifyEmail({ subject: "Hello", bodyPreview: "Hope your week is going well" }).label).toBe("unrelated");
  });
});

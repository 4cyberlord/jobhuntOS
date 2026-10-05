import { describe, expect, it } from "vitest";
import { cardSkills } from "./GateCard";

describe("GATE card skills", () => {
  it("prefers rich required-skill facts and preserves their display labels", () => {
    expect(cardSkills({ required_skills: [{ skill: "TypeScript" }, { skill: "React" }], technologies: ["Python"] })).toEqual(["TypeScript", "React"]);
  });

  it("falls back to technologies and then technical-stack arrays", () => {
    expect(cardSkills({ technologies: ["Python", "Docker", "Python"] })).toEqual(["Python", "Docker"]);
    expect(cardSkills({ technical_stack: { languages: ["Go"], cloud: ["AWS"] } })).toEqual(["Go", "AWS"]);
  });
});

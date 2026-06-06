# Stakeholder Management and Communication Guide

Effective stakeholder management ensures alignment, builds trust, and enables product success through clear communication and relationship building.

## Stakeholder Mapping

### Power/Interest Grid

```
High Power │
           │  MANAGE CLOSELY      KEEP SATISFIED
           │  (High power,        (High power,
           │   High interest)     Low interest)
           │
           ├─────────────────────────────────────
           │
           │  KEEP INFORMED       MONITOR
           │  (Low power,         (Low power,
           │   High interest)     Low interest)
Low Power  │
           └──────────────────────────────────────→
              Low Interest        High Interest
```

### Manage Closely (High Power, High Interest)
**Who**: Executives, key customers, direct manager
**Strategy**: Regular updates, seek input on decisions, close collaboration
**Frequency**: Weekly 1-on-1s, involved in planning

### Keep Satisfied (High Power, Low Interest)
**Who**: Senior leaders not directly involved, board members
**Strategy**: High-level summaries, major milestones only
**Frequency**: Monthly updates, quarterly reviews

### Keep Informed (Low Power, High Interest)
**Who**: Team members, adjacent teams, power users
**Strategy**: Detailed updates, involve in discussions
**Frequency**: Regular team meetings, demo sessions

### Monitor (Low Power, Low Interest)
**Who**: Peripheral stakeholders, distant teams
**Strategy**: FYI updates only
**Frequency**: Quarterly newsletters, major announcements

## Communication Frameworks

### SCQA Framework

**Situation**: Set context
**Complication**: Identify problem
**Question**: Pose key question
**Answer**: Provide solution

**Example**:
**S**: Our Q2 goal is to increase retention by 20%
**C**: Current onboarding takes 7 days, users churn before seeing value
**Q**: How can we reduce time-to-value?
**A**: Redesign onboarding to achieve first insight in <24 hours

### BLUF (Bottom Line Up Front)

Start with the conclusion, then provide supporting details.

**Good**:
"Recommendation: Delay launch by 2 weeks to fix critical bugs. Details below."

**Bad**:
"We've been testing... found some issues... debated solutions... timeline might change..."

### The Pyramid Principle

Structure communication hierarchically:

```
Main message (conclusion)
├── Supporting argument 1
│   ├── Evidence A
│   └── Evidence B
├── Supporting argument 2
│   ├── Evidence C
│   └── Evidence D
└── Supporting argument 3
    ├── Evidence E
    └── Evidence F
```

## Communication Formats

### Status Update Template

```markdown
## Status Update: [Project Name]
**Date**: [Date]
**Owner**: [Your name]

### TL;DR
[One-sentence summary of status and key point]

### Progress This Week
- ✅ Completed design reviews
- ✅ Finished API integration
- 🔄 In progress: Frontend implementation

### Metrics
- KR1: 60% → 65% (target: 80%)
- KR2: On track
- KR3: At risk

### Blockers
1. **Blocker**: Waiting on legal approval for terms
   - **Impact**: Blocks launch
   - **Action**: Meeting scheduled for Friday

### Next Week
- Complete frontend implementation
- Begin QA testing
- Finalize launch plan

### Help Needed
- Design review for confirmation flow
- QA resources for testing
```

### Decision Document Template

```markdown
## Decision: [Title]
**Date**: [Date]
**Owner**: [Your name]
**Status**: [Proposed / Approved / Implemented]

### TL;DR
[One-sentence summary of decision and rationale]

### Background
[Context: Why are we making this decision?]

### Problem
[What problem are we solving?]

### Options
**Option 1: [Name]**
- Pros: [List]
- Cons: [List]
- Effort: [Estimate]

**Option 2: [Name]**
- Pros: [List]
- Cons: [List]
- Effort: [Estimate]

### Recommendation
[Which option and why]

### Trade-offs
[What are we giving up?]

### Success Metrics
[How will we know this was the right decision?]

### Open Questions
[What still needs to be resolved?]
```

### Executive Summary Template

```markdown
## [Project Name]: Executive Summary
**Date**: [Date]
**Status**: [Green/Yellow/Red]

### Overview
[2-3 sentences: What, why, when]

### Status
- **Timeline**: On track for [date]
- **Budget**: [$ spent / $ allocated]
- **Team**: [# people, key roles filled/open]

### Key Wins
1. [Achievement 1]
2. [Achievement 2]

### Risks
1. **[Risk]**: [Mitigation]
2. **[Risk]**: [Mitigation]

### Decisions Needed
1. [Decision 1]: [By when, from whom]
2. [Decision 2]: [By when, from whom]

### Ask
[What do you need from leadership?]
```

## Meeting Best Practices

### Before the Meeting

**Agenda Template**:
```markdown
## Meeting: [Title]
**Date/Time**: [When]
**Attendees**: [Who]
**Duration**: [How long]

### Objective
[What we want to accomplish]

### Agenda
1. [Topic 1] - 10 min - [Owner]
2. [Topic 2] - 20 min - [Owner]
3. [Topic 3] - 15 min - [Owner]

### Pre-read Materials
- [Link to doc 1]
- [Link to doc 2]

### Expected Outcomes
- [Decision 1]
- [Alignment on 2]
```

**Send**:
- Agenda 24 hours before
- Pre-read materials
- Clear objectives

### During the Meeting

**Run Effectively**:
- Start on time
- State objective
- Time-box discussions
- Take notes
- Capture action items
- End with summary

**Facilitate Discussion**:
- "What do others think?"
- "Let's hear from [quiet person]"
- "I'm hearing... is that correct?"
- "Let's park that and discuss after"

### After the Meeting

**Follow-up Template**:
```markdown
## Meeting Notes: [Title]
**Date**: [When]
**Attendees**: [Who]

### Decisions Made
1. [Decision]: [Rationale]
2. [Decision]: [Rationale]

### Action Items
- [ ] [Action] - Owner: [Name] - Due: [Date]
- [ ] [Action] - Owner: [Name] - Due: [Date]

### Open Questions
1. [Question]: [Who will resolve, by when]

### Next Steps
[What happens next]
```

**Send within 24 hours**

## Managing Difficult Conversations

### Delivering Bad News

**Framework**: Situation → Impact → Next Steps

**Example**:
"We discovered a security vulnerability during testing (situation). This means we need to delay launch by 2 weeks to fix it properly (impact). We're prioritizing the fix, and I'll send daily updates on progress (next steps)."

**Don'ts**:
- Don't bury the lead
- Don't blame others
- Don't make excuses
- Don't surprise leadership

**Dos**:
- Be direct and honest
- Own the issue
- Have a plan
- Communicate early

### Handling Disagreements

**Disagree and Commit**:
1. Voice your perspective
2. Listen to others
3. Make a decision (or defer to decision-maker)
4. Commit fully to the decision
5. Don't relitigate later

**When You Disagree**:
"I hear your perspective. Here's my concern: [explain]. Can we discuss the trade-offs?"

**When Others Disagree**:
"Help me understand your concern. What would change your mind? What data would help?"

### Managing Up

**Your Manager's Needs**:
- No surprises
- Options, not just problems
- Clear asks (decision, input, FYI)
- Respect their time

**Update Format**:
```markdown
### Weekly Update to Manager

**Wins**:
- Shipped feature X, improved metric Y by Z%

**In Progress**:
- Feature A (on track for next sprint)
- Feature B (design review this week)

**Blockers**:
- Need budget approval for vendor ($X)
- Waiting on legal review (since [date])

**Asks**:
- Decision: Should we cut feature C to hit timeline?
- Input: Review PRD for project D
- FYI: Had great customer feedback session
```

## Stakeholder Communication Plan

### Template

| Stakeholder | Interest | Power | Message | Format | Frequency | Owner |
|------------|----------|-------|---------|--------|-----------|-------|
| CEO | Strategic impact | High | High-level progress | Email summary | Monthly | PM |
| CTO | Technical decisions | High | Detailed tech updates | 1-on-1 | Weekly | EM |
| Sales | Feature availability | Medium | Launch timelines | Slack channel | Weekly | PM |
| Customers | Product changes | High | Feature updates | Email/blog | Monthly | PM |
| Engineering | Requirements | High | Detailed specs | PRD, standups | Daily | PM |

### Example Plan: Product Launch

**4 Weeks Before Launch**:
- Executive team: Launch date confirmed, success metrics
- Engineering: Final testing checklist
- Sales: Demo training scheduled
- Marketing: Launch plan review
- Support: FAQ and training materials

**2 Weeks Before Launch**:
- Executive team: Go/no-go criteria review
- Engineering: Daily standups on critical issues
- Sales: Hands-on demo training
- Marketing: Content preview
- Support: Escalation process review

**Launch Week**:
- Executive team: Daily updates on metrics
- Engineering: War room for issues
- Sales: Launch announcement, demo recordings
- Marketing: Campaign launches
- Support: Extra coverage scheduled

**Post-Launch**:
- Executive team: Weekly metrics review
- Engineering: Bug triage and iteration plan
- Sales: Feedback collection, objection handling
- Marketing: Performance analysis
- Support: FAQ updates based on tickets

## Conflict Resolution

### Sources of Conflict

1. **Competing priorities**: Sales wants features, Engineering wants stability
2. **Resource constraints**: Everyone wants the same designers/engineers
3. **Timeline pressure**: Stakeholders want faster delivery
4. **Unclear ownership**: Who makes the final call?
5. **Information gaps**: Different assumptions or data

### Resolution Strategies

**1. Find Common Ground**
- Identify shared goals
- Focus on outcomes, not outputs
- "We all want to increase revenue. Let's discuss how."

**2. Use Data**
- Remove emotion from decision
- Show impact analysis
- "Here's what the data shows about user behavior."

**3. Make Trade-offs Explicit**
- Clarify what we're giving up
- "If we do X, we can't do Y. Which is more important?"

**4. Escalate Appropriately**
- When: Deadlock, major impact, cross-functional conflict
- How: Present options with pros/cons, not problems
- "We've narrowed it to two options. Here are the trade-offs. We need a decision by Friday."

**5. Document Decisions**
- Write down agreements
- Get explicit buy-in
- Share broadly

## Building Trust

### Trust-Building Actions

**Be Reliable**:
- Deliver on commitments
- If you can't, communicate early
- Underpromise, overdeliver

**Be Transparent**:
- Share information proactively
- Admit mistakes quickly
- Explain your reasoning

**Be Collaborative**:
- Seek input before deciding
- Give credit generously
- Share successes

**Be Responsive**:
- Reply to messages promptly
- Acknowledge even if you don't have answers
- Set expectations on response time

### Building Credibility

**Show Competence**:
- Know your domain
- Use data to support arguments
- Deliver results

**Show Judgment**:
- Make thoughtful decisions
- Explain trade-offs
- Learn from mistakes

**Show Integrity**:
- Do what you say
- Be consistent
- Prioritize user and business value

## Summary

**Effective Stakeholder Management**:
1. Map stakeholders by power and interest
2. Tailor communication to each audience
3. Update regularly and proactively
4. Be transparent about risks and trade-offs
5. Build trust through reliability and transparency
6. Resolve conflicts with data and common ground
7. Document decisions and share broadly

**Remember**: Stakeholders are partners in success. Clear communication and strong relationships enable you to deliver better products faster.

---

See `assets/templates/strategy/` for communication templates.

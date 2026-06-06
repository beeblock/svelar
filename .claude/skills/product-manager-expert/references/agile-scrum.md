# Agile and Scrum Practices Guide

Agile methodologies enable iterative product development with regular feedback loops and continuous improvement.

## Agile Principles

From the Agile Manifesto:

1. **Individuals and interactions** over processes and tools
2. **Working software** over comprehensive documentation
3. **Customer collaboration** over contract negotiation
4. **Responding to change** over following a plan

**Key Values**:
- Deliver value early and often
- Welcome changing requirements
- Collaborate daily between business and development
- Build projects around motivated individuals
- Face-to-face conversation is best
- Working product is the primary measure of progress
- Sustainable pace indefinitely
- Continuous attention to technical excellence
- Simplicity (maximizing work not done)
- Self-organizing teams
- Regular reflection and adjustment

## Scrum Framework

### Scrum Roles

**Product Owner (You)**:
- Owns the product vision and backlog
- Prioritizes work
- Defines acceptance criteria
- Makes trade-off decisions
- Stakeholder interface

**Scrum Master**:
- Facilitates scrum process
- Removes blockers
- Coaches team
- Shields team from interruptions
- Ensures ceremonies happen

**Development Team**:
- Cross-functional (design, eng, QA)
- Self-organizing
- 5-9 people ideal
- Collectively responsible for delivery

### Scrum Events (Ceremonies)

#### Sprint Planning
**When**: Start of each sprint
**Duration**: 2-4 hours (for 2-week sprint)
**Who**: Full team

**Agenda**:
1. **Review goal**: What will we accomplish?
2. **Select stories**: What can we commit to?
3. **Break down work**: How will we do it?
4. **Commit**: Team commits to sprint goal

**Product Manager Role**:
- Present prioritized backlog
- Clarify requirements
- Answer questions
- Help define sprint goal
- Negotiate scope if needed

**Outputs**:
- Sprint goal (one sentence)
- Committed stories
- Task breakdown

**Example Sprint Goal**:
"Enable users to create and share wishlists"

#### Daily Standup
**When**: Every day, same time
**Duration**: 15 minutes max
**Who**: Full team

**Format** (each person):
1. What did I do yesterday?
2. What will I do today?
3. Any blockers?

**Product Manager Role**:
- Listen for blockers to remove
- Clarify requirements if needed
- Avoid turning into status meeting

**Tips**:
- Stand up (keeps it short)
- Start on time, even if people missing
- Park detailed discussions for after
- Focus on progress toward sprint goal

#### Sprint Review (Demo)
**When**: End of sprint
**Duration**: 1-2 hours
**Who**: Team + stakeholders

**Agenda**:
1. Review sprint goal and what was planned
2. Demo completed work
3. Gather feedback
4. Discuss what didn't get done (and why)
5. Review product backlog and priorities

**Product Manager Role**:
- Facilitate demo
- Accept or reject stories
- Gather stakeholder feedback
- Preview next sprint priorities

**Best Practices**:
- Demo to real stakeholders, not just team
- Show working product, not slides
- Be honest about what didn't get done
- Celebrate wins

#### Sprint Retrospective
**When**: After sprint review
**Duration**: 1 hour
**Who**: Team only (no stakeholders)

**Format**:
1. What went well?
2. What didn't go well?
3. What will we change?

**Product Manager Role**:
- Participate as team member
- Listen to feedback
- Commit to improvements
- Focus on process, not blame

**Example Improvements**:
- "PRDs not detailed enough" → Add more wireframes
- "Requirements changed mid-sprint" → Lock scope earlier
- "Blocked waiting for design" → Design one sprint ahead

**Outputs**:
- 1-3 specific action items for next sprint
- Assign owners and track

#### Backlog Refinement
**When**: Mid-sprint
**Duration**: 1-2 hours
**Who**: PM + subset of team

**Purpose**: Prepare stories for upcoming sprints

**Activities**:
- Add detail to stories
- Break down epics
- Estimate stories
- Clarify requirements
- Identify dependencies

**Product Manager Role**:
- Present upcoming stories
- Provide context
- Answer questions
- Help split stories

**Output**: Stories "ready" for sprint planning
- Acceptance criteria defined
- Dependencies identified
- Estimated
- Designs attached

## Backlog Management

### Backlog Structure

```
NOW (Next 1-2 sprints)
├── Story 1 (Ready: estimated, designed, detailed)
├── Story 2 (Ready)
└── Story 3 (Ready)

NEXT (2-4 sprints out)
├── Story 4 (Needs estimation)
├── Story 5 (Needs design)
└── Epic 1 (Needs breakdown)

LATER (Icebox)
├── Ideas
├── Tech debt
└── Maybes
```

### Story Readiness (Definition of Ready)

A story is "ready" when:
- [ ] User story format filled out
- [ ] Acceptance criteria defined
- [ ] Estimated by team
- [ ] Dependencies identified
- [ ] Design/mockups attached
- [ ] Technical approach discussed
- [ ] Testable

### Story Completion (Definition of Done)

A story is "done" when:
- [ ] Code written and reviewed
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Acceptance criteria met
- [ ] Tested on all browsers/devices
- [ ] Accessibility tested
- [ ] Product owner accepted
- [ ] Merged to main branch
- [ ] Deployed to production (or ready to deploy)
- [ ] Documentation updated

### Prioritization in Backlog

**Top**: Next sprint
- P0 features
- Critical bugs
- Dependencies for other work

**Middle**: Coming soon
- P1 features
- Important tech debt
- Medium bugs

**Bottom**: Someday/maybe
- P2 features
- Nice-to-haves
- Low-priority bugs

## Estimation

### Story Points

**Fibonacci Scale**: 1, 2, 3, 5, 8, 13
- Relative sizing, not time
- Compare to reference stories
- Includes all work (code, test, review, deploy)

**Guideline**:
- 1 point: Trivial (few hours)
- 2 points: Simple (half day)
- 3 points: Moderate (1-2 days)
- 5 points: Complex (3-4 days)
- 8 points: Very complex (full week)
- 13 points: Epic (needs breakdown)

### Planning Poker

**Process**:
1. PM reads story
2. Team asks questions
3. Each person selects card privately
4. Reveal simultaneously
5. Discuss outliers (high and low)
6. Re-vote until consensus

**Benefits**:
- Engages whole team
- Surfaces different perspectives
- Builds shared understanding
- Prevents anchoring bias

### Velocity Tracking

**Definition**: Story points completed per sprint

**Example**:
- Sprint 1: 18 points
- Sprint 2: 22 points
- Sprint 3: 20 points
- Average: 20 points

**Use for Planning**:
- Commit to ~20 points per sprint
- Leave buffer for unknowns
- Track trends (improving vs declining)

**Don't**:
- Compare velocity across teams
- Use for individual performance
- Optimize for velocity over value
- Commit to more than average

## Product Manager in Scrum

### Daily Responsibilities

**Morning**:
- Attend standup
- Unblock team
- Answer questions

**Throughout Day**:
- Refine upcoming stories
- Stakeholder communication
- User research
- Competitive analysis
- Strategic planning

**End of Day**:
- Review progress on sprint goal
- Prep for tomorrow's questions

### Sprint Responsibilities

**Week 1** (of 2-week sprint):
- Sprint planning (Day 1)
- Daily standups
- Stakeholder updates
- Refine next sprint backlog
- Design reviews

**Week 2**:
- Daily standups
- Sprint review prep
- Demo to stakeholders
- Sprint retrospective
- Plan next sprint priorities

### Working with Engineering

**Best Practices**:
- Respect sprint commitments (no mid-sprint changes)
- Provide context, not solutions
- Trust technical decisions
- Shield from distractions
- Celebrate wins together

**Red Flags**:
- Micromanaging implementation
- Changing requirements mid-sprint
- Blaming for missed commitments
- Bypassing team to go direct to individuals

### Handling Scope Changes

**Mid-Sprint Request**:
1. **Assess urgency**: Is it truly urgent?
2. **Evaluate impact**: What do we stop working on?
3. **Consult team**: Can we absorb it?
4. **Make trade-off**: Swap stories of equal size
5. **Document**: Why we made the change

**General Rule**: Protect the sprint. Most things can wait 2 weeks.

## Common Anti-Patterns

### 1. Scrum Theater
**Problem**: Going through motions without embracing values
**Example**: Standups as status reports, retrospectives with no action

**Fix**: Focus on outcomes, not process

### 2. Feature Factory
**Problem**: Measuring success by features shipped, not impact
**Example**: Roadmap is list of features, not outcomes

**Fix**: Define success metrics, measure impact

### 3. Waterfall Sprints
**Problem**: Each sprint is a phase (design, then build, then test)
**Example**: Sprint 1 = design, Sprint 2 = code, Sprint 3 = QA

**Fix**: Vertical slices delivering value each sprint

### 4. Overcommitting
**Problem**: Committing to more than team can deliver
**Example**: Consistently missing sprint goals

**Fix**: Use historical velocity, leave buffer

### 5. Scope Creep
**Problem**: Adding work mid-sprint without removing anything
**Example**: "Just one more thing..."

**Fix**: Protect sprint commitments, add to next sprint

## Scaled Agile

### Multiple Teams

**Challenges**:
- Coordination between teams
- Shared dependencies
- Consistent sprint cadence
- Integration of work

**Approaches**:

**Scrum of Scrums**:
- Representatives from each team meet
- Share progress and dependencies
- Escalate blockers
- Coordinate releases

**SAFe (Scaled Agile Framework)**:
- Program Increment (PI) Planning
- Aligned sprints across teams
- Release trains
- Portfolio-level planning

**Best Practices**:
- Align sprint boundaries
- Shared definition of done
- Regular integration
- Clear ownership boundaries

## Product Metrics in Sprints

### Sprint Metrics

**Velocity**: Points completed per sprint
**Commitment Accuracy**: % of committed stories completed
**Cycle Time**: Days from start to done
**Lead Time**: Days from backlog to production
**Bug Rate**: Bugs per story

### Product Metrics

Track in every sprint review:
- Key product metrics (retention, engagement, conversion)
- OKR progress
- User feedback trends
- Support ticket volume

**Connect Work to Outcomes**:
"We shipped wishlist feature. Early data shows +15% return visit rate."

## Summary

**Effective Agile Product Management**:
1. Prioritize ruthlessly
2. Keep stories small and ready
3. Respect sprint commitments
4. Embrace changing requirements (between sprints)
5. Measure outcomes, not outputs
6. Continuous improvement through retrospectives
7. Build trust with engineering team
8. Focus on delivering value

**Remember**: Agile is a mindset, not a checklist. Adapt the process to fit your team and context.

---

See `assets/templates/planning/` for agile templates.

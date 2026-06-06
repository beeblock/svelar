# Product Discovery and Validation Guide

Product discovery is learning what to build. Delivery is building it. Great products require both.

## Discovery vs Delivery

**Discovery (Validate the idea)**:
- What problem are we solving?
- For whom?
- How do we know it's valuable?
- How do we know it's feasible?
- How do we know it's viable (business)?

**Delivery (Build the solution)**:
- Design and engineer the solution
- Test and iterate
- Launch and measure

**Key Insight**: Spend time in discovery to avoid building the wrong thing.

## The Four Risks

Every product idea has four risks to validate:

### 1. Value Risk
**Question**: Will users find this valuable?

**Validate**:
- User interviews
- Prototype testing
- Demand testing (landing pages, waitlists)
- Fake door tests

### 2. Usability Risk
**Question**: Can users figure out how to use it?

**Validate**:
- Usability testing
- Prototype walkthroughs
- Wizard of Oz testing
- Beta programs

### 3. Feasibility Risk
**Question**: Can we build this?

**Validate**:
- Technical spikes
- Proof-of-concept
- Architecture review
- Third-party API testing

### 4. Viability Risk
**Question**: Should we build this (business perspective)?

**Validate**:
- Business case analysis
- Cost modeling
- Market sizing
- Competitive analysis
- Legal/compliance review

## Discovery Process

### Step 1: Identify Opportunities

**Sources**:
- User feedback and complaints
- Usage data and analytics
- Competitive analysis
- Market research
- Strategic company goals
- Team ideas

**Questions**:
- What problems do users have?
- What opportunities exist in the market?
- What aligns with our strategy?

### Step 2: Frame the Problem

**Problem Statement Template**:
```
[User type] needs to [accomplish something]
but currently [pain point]
which causes [negative outcome].

We know this because [evidence].
```

**Example**:
Small business owners need to understand their cash flow
but currently use spreadsheets and manual tracking
which causes errors and missed financial insights.

We know this because: 15/20 interview participants mentioned this, support tickets show 50+ requests/month for better reporting.

### Step 3: Research and Understand

**User Research Methods**:

**Qualitative (Why)**:
- User interviews (1-on-1, 30-60 min)
- Contextual inquiry (observe in environment)
- Diary studies (users log experiences)
- Usability testing

**Quantitative (What, How Many)**:
- Surveys
- Analytics analysis
- A/B tests
- Cohort analysis

### Step 4: Generate Solutions

**Brainstorming**:
- Diverge first (many ideas, no judgment)
- Converge later (evaluate and select)
- Involve diverse perspectives (design, eng, sales, support)

**Techniques**:
- Crazy 8s (8 ideas in 8 minutes)
- How Might We questions
- Jobs to Be Done framework
- User journey mapping

### Step 5: Prototype and Test

**Fidelity Levels**:

**Low-Fidelity** (hours):
- Sketches
- Wireframes
- Clickable mockups
- Paper prototypes

**Medium-Fidelity** (days):
- Interactive prototypes (Figma, InVision)
- Clickable flows
- Basic interactions

**High-Fidelity** (weeks):
- Working prototypes
- MVP with core functionality
- Wizard of Oz (manual backend)

**When to Use**:
- Low: Validate concept and flow
- Medium: Validate interaction and usability
- High: Validate technical feasibility and value

### Step 6: Validate Assumptions

**Test Your Riskiest Assumptions First**

**Example**: Chat Support Feature

**Assumptions**:
1. Users want real-time support (value risk - HIGH)
2. Users will use chat over email (value risk - HIGH)
3. We can staff chat 24/7 (feasibility risk - MEDIUM)
4. Chat reduces support costs (viability risk - HIGH)

**Validation Plan**:
1. Test with fake chat button ("Coming soon" - gauge clicks)
2. Interview users about support preferences
3. Wizard of Oz test (manual chat before building)
4. Cost model for staffing
5. Analyze competitors' chat usage

## User Research Techniques

### User Interviews

**Structure**:
1. **Warm-up** (5 min): Build rapport
2. **Context** (10 min): Understand their world
3. **Deep dive** (30 min): Explore problem area
4. **Close** (5 min): Follow-up questions

**Good Questions**:
- "Tell me about the last time you [did task]"
- "Walk me through how you currently [solve problem]"
- "What's frustrating about [current solution]?"
- "How would you feel if you could no longer [use product]?"

**Bad Questions**:
- "Would you use this feature?" (They'll say yes to be nice)
- "Do you like this design?" (Opinion, not behavior)
- Leading questions that bias answers

**Tips**:
- Ask open-ended questions
- Listen more than talk (80/20 rule)
- Ask "why" 5 times to get to root cause
- Observe behavior, not just words
- Record (with permission) for later review

### Usability Testing

**Setup**:
1. Give user a prototype
2. Assign realistic tasks
3. Think aloud protocol
4. Observe where they struggle
5. Don't help (let them struggle)

**Example Tasks**:
- "Find and purchase a blue t-shirt in size medium"
- "Create a new project and invite a team member"
- "Generate a report for last month's sales"

**What to Look For**:
- Where do they get confused?
- What do they expect to happen?
- What words do they use?
- Where do they give up?

**Sample Size**: 5 users finds 85% of usability issues

### Surveys

**When to Use**:
- Quantify findings from interviews
- Reach many users quickly
- Track trends over time

**Question Types**:
- Multiple choice (easy to analyze)
- Rating scales (1-5, NPS)
- Open-ended (qualitative insights)

**Best Practices**:
- Keep it short (<10 questions)
- Start broad, end specific
- Avoid leading questions
- Test survey before sending
- Incentivize completion

### Analytics Analysis

**Key Questions**:
- Where do users drop off?
- What features are used most?
- How long do tasks take?
- What paths do users take?

**Tools**:
- Google Analytics, Mixpanel, Amplitude
- Heatmaps (Hotjar, FullStory)
- Session recordings
- Funnel analysis
- Cohort analysis

## Testing Techniques

### A/B Testing

**Definition**: Show different versions to different users, measure which performs better.

**Example**:
- **Variation A**: Green "Sign Up" button
- **Variation B**: Blue "Get Started" button
- **Measure**: Click-through rate

**Best Practices**:
- Test one variable at a time
- Run until statistical significance
- Segment results (mobile vs desktop)
- Consider full funnel impact

### Fake Door Testing

**Definition**: Show a feature that doesn't exist, measure interest.

**Example**:
- Add "Export to Excel" button
- Click shows "Coming soon! Want early access?"
- Measure: Click rate, email signups

**Use When**: Validating demand before building

### Wizard of Oz Testing

**Definition**: Feature appears to work but is manually operated behind the scenes.

**Example**:
- User requests "AI recommendations"
- Human manually generates recommendations
- User sees instant "AI-powered" results

**Use When**: Testing value before building complex tech

### Concierge Testing

**Definition**: Manually deliver the service you plan to automate.

**Example**:
- Personally onboard first 10 customers
- Manually analyze their data
- Deliver insights by email
- Learn what's valuable before automating

### Landing Page Tests

**Definition**: Create landing page describing product, measure signups.

**Elements**:
- Value proposition headline
- Benefits and features
- Social proof
- Call-to-action (waitlist/signup)

**Measure**:
- Traffic → signup conversion
- Traffic sources
- Visitor demographics

## Minimum Viable Product (MVP)

### What MVP Is

**Definition**: Smallest version that:
- Solves the core problem
- Delivers value to users
- Teaches you what to build next

**MVP Is NOT**:
- Broken or buggy
- Missing core functionality
- Unusable
- Just a landing page (that's an experiment)

### MVP Examples

**Dropbox**:
- **MVP**: Video demo showing how it would work
- **Not**: Just file sync (that's feature parity)
- **Learned**: People understood and wanted it

**Airbnb**:
- **MVP**: Founders' apartment photos on Craigslist
- **Not**: Full booking platform
- **Learned**: People would rent from strangers

**Zappos**:
- **MVP**: Buy shoes from retail stores, ship to customers
- **Not**: Inventory and warehouse
- **Learned**: People would buy shoes online

### Defining Your MVP

**Step 1: Identify Core Value**
What's the one problem you solve?

**Step 2: Remove Everything Else**
What can you cut and still deliver value?

**Step 3: Define Success**
How will you know if it's working?

**Example: Task Management App**

**Full Vision**:
- Create/edit/delete tasks
- Assign to team members
- Due dates and reminders
- Comments and attachments
- Calendar view
- Mobile app
- Integrations (Slack, email)
- Analytics dashboard

**MVP**:
- Create/edit/delete tasks
- Assign to team members
- Due dates
- Web only

**Success Metrics**:
- 100 users sign up
- 60% create 5+ tasks
- 40% return daily
- NPS >40

## Lean Startup Methodology

### Build-Measure-Learn Loop

```
IDEA
  ↓
BUILD (Minimum feature set)
  ↓
PRODUCT
  ↓
MEASURE (Data and user feedback)
  ↓
DATA
  ↓
LEARN (Insights and decisions)
  ↓
[Pivot or Persevere]
  ↓
IDEA (Next iteration)
```

### Pivots

**When to Pivot**:
- Core assumptions proven wrong
- No product-market fit after iterations
- Better opportunity discovered

**Types of Pivots**:
- **Zoom-in**: One feature becomes the product
- **Zoom-out**: Product becomes one feature of larger vision
- **Customer segment**: Different target market
- **Problem**: Solving a different problem
- **Platform**: Product to platform (or vice versa)
- **Business model**: Change monetization

**Example**: Instagram
- Started as location check-in app (Burbn)
- Pivoted to photo sharing (one feature)
- Found product-market fit

## Jobs to Be Done (JTBD)

**Framework**: People "hire" products to do a job.

**Format**:
```
When [situation],
I want to [motivation],
So I can [expected outcome].
```

**Example**:
When I'm commuting to work (situation),
I want to learn something useful (motivation),
So I can grow professionally without extra time commitment (outcome).

**Product**: Podcasts, audiobooks, educational apps

**Insight**: Competing with boredom, not just other education products.

## Discovery Artifacts

### Opportunity Solution Tree

```
OPPORTUNITY (Business goal)
├── SOLUTION 1
│   ├── Experiment A
│   └── Experiment B
├── SOLUTION 2
│   ├── Experiment C
│   └── Experiment D
└── SOLUTION 3
    └── Experiment E
```

**Example**:
**Opportunity**: Increase trial-to-paid conversion

**Solutions**:
1. Improve onboarding
   - Experiment: Interactive tutorial
   - Experiment: Progress checklist
2. Demonstrate value faster
   - Experiment: Sample data playground
   - Experiment: Personalized dashboards
3. Reduce friction
   - Experiment: Remove credit card requirement
   - Experiment: Simplify signup

### Research Repository

**Organize Findings**:
- User interview notes and recordings
- Survey results
- Analytics dashboards
- Usability test videos
- Competitive analysis
- Prototype links

**Make Discoverable**:
- Tag by theme (onboarding, pricing, etc.)
- Searchable
- Updated regularly
- Shared with team

## Summary

**Effective Discovery**:
1. Validate value, usability, feasibility, viability
2. Talk to users regularly (interviews, testing)
3. Prototype early and often
4. Test riskiest assumptions first
5. Build MVPs that teach you
6. Iterate based on learning
7. Use data to inform decisions

**Remember**: Time spent in discovery saves time in delivery. Build the right thing before you build it right.

---

See `assets/templates/research/` for discovery templates:
- `user-research-plan.md`
- `interview-guide.md`
- `usability-test-plan.md`

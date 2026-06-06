# Feature Prioritization Guide

A comprehensive guide to prioritization frameworks for making data-driven decisions about what to build next.

## Why Prioritization Matters

Every "yes" is a "no" to something else. Prioritization ensures you:
- Build the right features
- Maximize impact with limited resources
- Say no strategically
- Align teams on what matters most

## RICE Scoring Framework

**Formula**: (Reach × Impact × Confidence) / Effort

### Reach
How many users/customers affected per time period?
- Monthly active users
- Transactions per quarter
- Support tickets per month

**Example**:
- Feature affects 1,000 users per month = 1000
- Feature affects 50% of users = 5000 (if 10K MAU)

### Impact
How much does this impact each user?
- **Massive** = 3.0 (game-changing)
- **High** = 2.0 (significant improvement)
- **Medium** = 1.0 (noticeable improvement)
- **Low** = 0.5 (minor improvement)
- **Minimal** = 0.25 (barely noticeable)

**Guidelines**:
- Massive: Solves critical pain point, enables new use cases
- High: Significantly improves key workflow
- Medium: Moderately improves experience
- Low: Nice-to-have improvement
- Minimal: Edge case or minor polish

### Confidence
How confident are you in your estimates?
- **High** = 100% (strong data, done before)
- **Medium** = 80% (some data, reasonable assumptions)
- **Low** = 50% (limited data, many assumptions)

**Use low confidence** for:
- Untested assumptions
- New technology
- Market expansion
- Complex features

### Effort
Person-months of work (all team members combined)
- Design + Engineering + QA + PM
- Include everything: coding, testing, reviews, deployment

**Example**:
- 2 engineers × 2 weeks + 1 designer × 1 week = 1.25 person-months

### RICE Examples

**Feature A: Password Reset**
- Reach: 200 users per month (forgotten password)
- Impact: 3 (Massive - currently can't access account)
- Confidence: 100% (common feature, clear requirements)
- Effort: 1 person-month
- **Score**: (200 × 3 × 1.0) / 1 = **600**

**Feature B: Dark Mode**
- Reach: 10,000 users (50% of users want it)
- Impact: 1 (Medium - visual preference)
- Confidence: 80% (survey data, some assumptions on usage)
- Effort: 3 person-months (requires redesign of all screens)
- **Score**: (10,000 × 1 × 0.8) / 3 = **2,667**

**Feature C: AI Recommendations**
- Reach: 20,000 users (all users)
- Impact: 2 (High - improves discovery)
- Confidence: 50% (unproven, experimental)
- Effort: 6 person-months (ML model, infrastructure)
- **Score**: (20,000 × 2 × 0.5) / 6 = **3,333**

**Priority Order**: C (3333) > B (2667) > A (600)

### RICE Template

```markdown
## Feature: [Name]

**Reach**: [Number] users per [time period]
- Calculation: [Explain]

**Impact**: [Score 0.25-3.0]
- Rating: [Massive/High/Medium/Low/Minimal]
- Rationale: [Why this score?]

**Confidence**: [Percentage]
- Rating: [High/Medium/Low]
- Based on: [Data sources, assumptions]

**Effort**: [Person-months]
- Design: [X weeks]
- Engineering: [X weeks]
- QA: [X weeks]
- Total: [Y person-months]

**RICE Score**: ([Reach] × [Impact] × [Confidence]) / [Effort] = **[Score]**

**Priority**: [Rank among other features]
```

## MoSCoW Method

Categorize features into four buckets:

### Must Have (P0)
- **Definition**: Product fails without it
- **Characteristics**:
  - Legal/compliance requirement
  - Core functionality
  - Competitive necessity
  - Critical user need

**Examples**:
- User authentication (can't use product without login)
- Payment processing (e-commerce can't function)
- Data security (regulatory requirement)

### Should Have (P1)
- **Definition**: Important but workarounds exist
- **Characteristics**:
  - Significantly improves UX
  - High user demand
  - Painful workaround
  - Competitive feature

**Examples**:
- Password reset (workaround: contact support)
- Search filters (workaround: scroll/browse)
- Email notifications (workaround: check app)

### Could Have (P2)
- **Definition**: Desirable but not necessary
- **Characteristics**:
  - Nice-to-have improvement
  - Low-impact enhancement
  - Long-term quality of life
  - Differentiator but not critical

**Examples**:
- Dark mode
- Keyboard shortcuts
- Export to PDF
- Custom themes

### Won't Have (Out of Scope)
- **Definition**: Explicitly not included
- **Characteristics**:
  - Out of scope for this release
  - Low value relative to effort
  - Doesn't align with strategy
  - Future consideration

**Examples**:
- Mobile app (focusing on web first)
- International expansion (US market first)
- Advanced analytics (basic metrics sufficient)

### MoSCoW Example: E-commerce MVP

**Must Have**:
- Browse products
- View product details
- Add to cart
- Checkout and pay
- Order confirmation

**Should Have**:
- Product search
- Filter by category/price
- Save shipping address
- Order history

**Could Have**:
- Product reviews
- Wishlist
- Guest checkout
- Gift messaging

**Won't Have** (for MVP):
- Loyalty program
- Subscription service
- Mobile app
- International shipping

## Kano Model

Categorize features by customer satisfaction impact.

### Basic Needs (Expected)
- **Definition**: Expected features, dissatisfaction if absent
- **Satisfaction**: Doesn't increase satisfaction if present
- **Examples**:
  - Website loads quickly
  - Product images display
  - Secure checkout
  - Email confirmation

**Strategy**: Implement efficiently, don't over-invest

### Performance Needs (Linear)
- **Definition**: More is better, linear satisfaction
- **Satisfaction**: Proportional to quality
- **Examples**:
  - Search relevance (better results = happier)
  - Load time (faster = happier)
  - Product selection (more options = happier)
  - Customer support response time

**Strategy**: Continuously improve, competitive differentiator

### Excitement Needs (Delighters)
- **Definition**: Unexpected features, delight when present
- **Satisfaction**: High satisfaction if present, neutral if absent
- **Examples**:
  - Free surprise upgrade
  - Personalized thank you note
  - Proactive issue resolution
  - Unexpected feature (AR try-on)

**Strategy**: Differentiate, create "wow" moments

### Kano Analysis Process

1. **Survey Users**: Ask two questions per feature:
   - "How would you feel if this feature was present?"
   - "How would you feel if this feature was absent?"

2. **Categorize Responses**:
   - I like it
   - I expect it
   - I'm neutral
   - I can tolerate it
   - I dislike it

3. **Plot Features**: Determine category
   - Most say "I expect it" if absent = Basic Need
   - Answers vary by quality = Performance Need
   - "I like it" if present, "I'm neutral" if absent = Delighter

4. **Prioritize**:
   - Basic Needs first (prevent dissatisfaction)
   - Performance Needs next (competitive parity)
   - Delighters last (differentiation)

## Value vs Effort Matrix

Plot features on 2×2 matrix:

```
High Value │
           │  Do Next        Do First
           │  (Big Bets)     (Quick Wins)
           │
           ├─────────────────────────────
           │
           │  Don't Do       Do Later
           │  (Money Pits)   (Fill-ins)
Low Value  │
           └────────────────────────────→
              High Effort     Low Effort
```

### Quick Wins (High Value, Low Effort)
- **Priority**: Do First
- **Examples**: Bug fixes, small UX improvements, copy changes
- **Strategy**: Ship fast, build momentum

### Big Bets (High Value, High Effort)
- **Priority**: Do Next
- **Examples**: Major features, platform changes
- **Strategy**: Plan carefully, break into milestones

### Fill-ins (Low Value, Low Effort)
- **Priority**: Do Later
- **Examples**: Minor polish, edge case handling
- **Strategy**: Backlog items for slack time

### Money Pits (Low Value, High Effort)
- **Priority**: Don't Do
- **Examples**: Over-engineered solutions, nice-to-haves
- **Strategy**: Say no, cut from roadmap

## ICE Scoring

Simpler alternative to RICE.

**Formula**: (Impact + Confidence + Ease) / 3

### Impact (1-10)
How much will this move key metrics?
- 10: Game-changing
- 5: Noticeable improvement
- 1: Minimal impact

### Confidence (1-10)
How certain are you about impact?
- 10: Strong data, proven approach
- 5: Reasonable assumptions
- 1: Pure speculation

### Ease (1-10)
How easy is it to implement?
- 10: Hours of work
- 5: Weeks of work
- 1: Months of work

### ICE Example

**Feature: Email Notifications**
- Impact: 7 (Improves engagement)
- Confidence: 8 (Other products show this works)
- Ease: 9 (Email service already integrated)
- **Score**: (7 + 8 + 9) / 3 = **8.0**

**Feature: AI Chatbot**
- Impact: 9 (Could revolutionize support)
- Confidence: 4 (Unproven in our domain)
- Ease: 2 (Requires ML infrastructure)
- **Score**: (9 + 4 + 2) / 3 = **5.0**

**Priority**: Email Notifications (8.0) > AI Chatbot (5.0)

## Weighted Scoring

Custom framework with weighted criteria.

### Example Criteria

| Criterion | Weight | Feature A | Feature B |
|-----------|--------|-----------|-----------|
| User Value | 40% | 8 | 6 |
| Revenue Impact | 25% | 5 | 9 |
| Strategic Alignment | 20% | 7 | 8 |
| Technical Feasibility | 15% | 9 | 4 |
| **Total Score** | 100% | **7.25** | **7.05** |

**Calculation for Feature A**:
- (8 × 0.40) + (5 × 0.25) + (7 × 0.20) + (9 × 0.15) = 7.25

**Calculation for Feature B**:
- (6 × 0.40) + (9 × 0.25) + (8 × 0.20) + (4 × 0.15) = 7.05

**Priority**: Feature A (7.25) > Feature B (7.05)

### Define Your Criteria

Based on company priorities:
- **User-focused**: User value, UX improvement, accessibility
- **Revenue-focused**: Revenue impact, conversion rate, ARPU
- **Growth-focused**: Acquisition, activation, viral coefficient
- **Strategic**: Market positioning, competitive advantage, vision alignment
- **Operational**: Technical debt, maintenance, infrastructure

## Cost of Delay

Quantify the cost of not doing something now.

### CD3 Framework

**Formula**: Cost of Delay / Duration

**Cost of Delay**: Monthly revenue/value lost by not having feature
**Duration**: Months to build feature

**Example**:

**Feature A**: Checkout improvement
- Cost of Delay: $50K/month (increased conversions)
- Duration: 2 months
- **CD3**: $50K / 2 = **$25K per month per month**

**Feature B**: New integration
- Cost of Delay: $20K/month (new revenue stream)
- Duration: 1 month
- **CD3**: $20K / 1 = **$20K per month per month**

**Priority**: Feature A ($25K) > Feature B ($20K)

### Types of Cost of Delay

**Revenue-generating**:
- New paid features
- Upsell opportunities
- Market expansion

**Risk-reducing**:
- Security vulnerabilities
- Performance issues
- Compliance requirements

**Efficiency-improving**:
- Automation
- Tool improvements
- Process streamlining

**Strategic**:
- Competitive positioning
- Market learning
- Platform capabilities

## Opportunity Scoring

Rate features on importance and satisfaction.

### Process

1. **Survey users**: Rate each feature
   - "How important is [feature] to you?" (1-5)
   - "How satisfied are you with [feature]?" (1-5)

2. **Calculate Opportunity Score**:
   - Importance + max(Importance - Satisfaction, 0)
   - Higher score = bigger opportunity

3. **Prioritize**: Features with high importance, low satisfaction

### Example

**Feature: Search**
- Importance: 4.5 (very important)
- Satisfaction: 2.0 (poor)
- **Opportunity**: 4.5 + (4.5 - 2.0) = **7.0** (High priority!)

**Feature: Dark Mode**
- Importance: 3.0 (nice to have)
- Satisfaction: N/A (doesn't exist)
- **Opportunity**: 3.0 + 3.0 = **6.0** (Medium priority)

**Feature: Checkout**
- Importance: 5.0 (critical)
- Satisfaction: 4.5 (working well)
- **Opportunity**: 5.0 + 0.5 = **5.5** (Low priority)

**Priority**: Search (7.0) > Dark Mode (6.0) > Checkout (5.5)

## Choosing a Framework

### Use RICE when:
- Need quantitative scoring
- Comparing diverse features
- Want to explain decisions
- Have data on reach/impact

### Use MoSCoW when:
- Planning MVP or release
- Need simple bucketing
- Aligning stakeholders
- Time-constrained decisions

### Use Kano when:
- Understanding user expectations
- Planning differentiation
- Long-term product strategy
- Feature discovery

### Use Value vs Effort when:
- Quick visual prioritization
- Explaining trade-offs
- Sprint planning
- Portfolio management

### Use ICE when:
- Need simple scoring
- Limited data available
- Fast decisions required
- Team estimation

## Real-World Example: SaaS Analytics Product

### Features to Prioritize

1. Real-time data streaming
2. Mobile app
3. API rate limit increase
4. Custom branding
5. Advanced user permissions
6. Dark mode
7. Scheduled reports
8. Data export to S3
9. Slack integration
10. Multi-language support

### RICE Analysis

| Feature | Reach | Impact | Confidence | Effort | Score |
|---------|-------|--------|------------|--------|-------|
| Scheduled reports | 5000 | 2.0 | 100% | 1 | 10,000 |
| Slack integration | 3000 | 1.0 | 80% | 1 | 2,400 |
| Advanced permissions | 500 | 3.0 | 100% | 2 | 750 |
| Real-time streaming | 1000 | 3.0 | 50% | 6 | 250 |
| API rate increase | 200 | 2.0 | 100% | 0.5 | 800 |
| Data export to S3 | 300 | 2.0 | 100% | 1 | 600 |
| Custom branding | 100 | 1.0 | 100% | 3 | 33 |
| Dark mode | 8000 | 0.5 | 80% | 2 | 1,600 |
| Mobile app | 4000 | 2.0 | 50% | 12 | 333 |
| Multi-language | 2000 | 1.0 | 50% | 4 | 250 |

### Priority Order

1. **Scheduled reports** (10,000) - Quick win, high demand
2. **Slack integration** (2,400) - High reach, easy
3. **Dark mode** (1,600) - Many users, reasonable effort
4. **API rate increase** (800) - Easy, benefits power users
5. **Advanced permissions** (750) - Critical for enterprise
6. **Data export to S3** (600) - Requested by large customers
7. **Mobile app** (333) - High effort, medium confidence
8. **Real-time streaming** (250) - High effort, unproven
9. **Multi-language** (250) - Lower priority market
10. **Custom branding** (33) - Low reach, high effort

### Roadmap Decision

**Q2**: Scheduled reports, Slack integration, Dark mode
**Q3**: API rate increase, Advanced permissions, Data export
**Q4**: Mobile app (phase 1), Real-time streaming (spike first)
**Backlog**: Multi-language, Custom branding

## Summary

**Effective Prioritization**:
1. Use data, not opinions
2. Choose framework that fits your context
3. Be transparent about trade-offs
4. Revisit priorities regularly
5. Communicate decisions clearly
6. Say no strategically

**Remember**: Perfect prioritization is impossible. The goal is consistent, defensible decisions that maximize impact.

---

See `assets/templates/research/feature-prioritization.md` for RICE scoring spreadsheet template.

# Task Breakdown and Work Estimation Guide

A comprehensive guide to breaking down epics into stories, stories into tasks, and estimating work effectively for product execution.

## Work Hierarchy

```
THEME (Strategic initiative, 6-12 months)
  ↓
EPIC (Major feature, 1-3 months)
  ↓
USER STORY (Deliverable feature slice, 1-2 weeks)
  ↓
TASK (Implementation work, hours to days)
  ↓
SUBTASK (Granular work item, minutes to hours)
```

### Example Hierarchy

**Theme**: Increase E-commerce Revenue
  - **Epic**: Shopping Cart System
    - **Story**: Add item to cart
      - **Task**: Create cart database schema
        - **Subtask**: Define tables and relationships
        - **Subtask**: Write migration script
      - **Task**: Build cart API endpoints
      - **Task**: Design cart button component
      - **Task**: Write unit tests
    - **Story**: View cart contents
    - **Story**: Update cart quantities
    - **Story**: Remove cart items

## Breaking Down Epics

### Start with User Journeys

Map the end-to-end user experience before breaking down work.

**Example: Payment Processing Epic**

**User Journey**:
1. Review order summary
2. Enter payment information
3. Confirm purchase
4. Receive confirmation

**Stories from Journey**:
- Story 1: Display order summary before payment
- Story 2: Enter credit card information
- Story 3: Process payment through Stripe
- Story 4: Show order confirmation page
- Story 5: Send confirmation email

### Vertical Slicing

Each story should be a vertical slice through all layers (frontend, backend, database).

**Bad (Horizontal Slices)**:
- Story 1: Build database schema for cart
- Story 2: Create API endpoints for cart
- Story 3: Build frontend cart UI

**Good (Vertical Slices)**:
- Story 1: Add item to cart (database + API + UI)
- Story 2: View cart contents (database + API + UI)
- Story 3: Remove item from cart (database + API + UI)

**Why Better**: Each story delivers user value and can be demoed.

### The SPIDR Framework

Use SPIDR to split large stories:

**S - Spike**: Research or proof-of-concept
**P - Paths**: Different user paths through the feature
**I - Interface**: Different UI platforms or channels
**D - Data**: Different data types or sources
**R - Rules**: Different business rules or logic

**Example: User Login**

**By Paths**:
- Story 1: Login with email/password
- Story 2: Login with Google OAuth
- Story 3: Login with Apple ID

**By Data**:
- Story 1: Login for standard users
- Story 2: Login for admin users
- Story 3: Login for organization accounts

**By Rules**:
- Story 1: Login without 2FA
- Story 2: Login with 2FA enabled
- Story 3: Login with SSO enforcement

### Walking Skeleton Approach

Build the thinnest possible end-to-end feature first, then add complexity.

**Epic**: Product Search

**Walking Skeleton (MVP)**:
- Simple keyword search
- Basic results list
- Click to view product

**Next Iterations**:
- Add filters (price, category, brand)
- Add sorting (relevance, price, popularity)
- Add autocomplete suggestions
- Add search history
- Add advanced search

This approach delivers value early and allows learning before investing in complexity.

## Breaking Down Stories into Tasks

### Task Types

**Frontend Tasks**:
- Component design
- UI implementation
- State management
- Form validation
- Styling and responsiveness
- Integration with APIs

**Backend Tasks**:
- API endpoint development
- Business logic implementation
- Data validation
- Database queries
- Third-party integrations
- Error handling

**Database Tasks**:
- Schema design
- Migrations
- Indexes
- Seed data
- Query optimization

**Infrastructure Tasks**:
- Deployment configuration
- Environment setup
- Monitoring and logging
- Security configuration

**Testing Tasks**:
- Unit tests
- Integration tests
- E2E tests
- Performance tests
- Accessibility tests

**Documentation Tasks**:
- API documentation
- User documentation
- Code comments
- Release notes

### Example: Add to Wishlist Story

**Story**: As a user, I want to add products to my wishlist

**Tasks**:

**Database**:
- [ ] Create `wishlists` table schema
- [ ] Create `wishlist_items` table schema
- [ ] Write migration scripts
- [ ] Add database indexes for performance

**Backend API**:
- [ ] Create POST `/api/wishlists/:id/items` endpoint
- [ ] Add authentication middleware
- [ ] Implement duplicate item handling
- [ ] Add rate limiting
- [ ] Write API integration tests

**Frontend**:
- [ ] Design "Add to Wishlist" button component
- [ ] Implement button in product page
- [ ] Add optimistic UI updates
- [ ] Handle loading and error states
- [ ] Write component unit tests

**Integration**:
- [ ] Connect frontend button to API
- [ ] Handle success/error responses
- [ ] Add analytics tracking events
- [ ] Test end-to-end flow

**Documentation**:
- [ ] Update API documentation
- [ ] Add inline code comments
- [ ] Create user help article

## Work Breakdown Structure (WBS)

A WBS is a hierarchical decomposition of work into manageable pieces.

### Example: E-commerce Checkout System

```
1.0 Checkout System
    │
    ├── 1.1 Guest Checkout
    │   ├── 1.1.1 Guest user flow design
    │   ├── 1.1.2 Session management
    │   ├── 1.1.3 Guest checkout form
    │   └── 1.1.4 Convert guest to registered user
    │
    ├── 1.2 Shipping Information
    │   ├── 1.2.1 Address form component
    │   ├── 1.2.2 Address validation API
    │   ├── 1.2.3 Save address for future
    │   └── 1.2.4 Multiple shipping addresses
    │
    ├── 1.3 Payment Processing
    │   ├── 1.3.1 Stripe integration
    │   │   ├── 1.3.1.1 Setup Stripe account
    │   │   ├── 1.3.1.2 Implement payment API
    │   │   └── 1.3.1.3 Handle webhooks
    │   ├── 1.3.2 Payment form UI
    │   ├── 1.3.3 Error handling
    │   └── 1.3.4 PCI compliance review
    │
    ├── 1.4 Order Confirmation
    │   ├── 1.4.1 Confirmation page
    │   ├── 1.4.2 Confirmation email
    │   ├── 1.4.3 Order history integration
    │   └── 1.4.4 Receipt generation
    │
    └── 1.5 Testing & QA
        ├── 1.5.1 Unit tests
        ├── 1.5.2 Integration tests
        ├── 1.5.3 E2E checkout tests
        ├── 1.5.4 Payment failure scenarios
        └── 1.5.5 Security testing
```

### WBS Numbering System

- **Level 1** (1.0): Major deliverable
- **Level 2** (1.1): Component or phase
- **Level 3** (1.1.1): Specific task
- **Level 4** (1.1.1.1): Subtask

This numbering helps track dependencies and progress.

## Identifying Dependencies

### Dependency Types

**Sequential (Finish-to-Start)**:
Task B cannot start until Task A is complete.

Example:
- Database schema MUST be created before API can use it
- API MUST be built before frontend can integrate

**Parallel (Independent)**:
Tasks can be done simultaneously.

Example:
- Frontend UI and backend API (with agreed contract)
- Documentation and testing
- Different microservices

**Soft Dependencies**:
Task B is easier if Task A is done, but not strictly required.

Example:
- Better to have designs before implementation
- Helpful to have API docs before building client

### Dependency Mapping

**Example: User Registration**

```
┌─────────────────────┐
│ Design User Flow    │ (Day 1-2)
└──────────┬──────────┘
           │
    ┌──────┴──────┬──────────────────────────┐
    │             │                          │
    ▼             ▼                          ▼
┌────────┐   ┌────────────┐          ┌──────────────┐
│ Design │   │ DB Schema  │          │ Email Setup  │
│ UI     │   │ Creation   │          │ (3rd party)  │
└───┬────┘   └─────┬──────┘          └──────┬───────┘
    │              │                        │
    │         ┌────┴────┐                   │
    │         │         │                   │
    ▼         ▼         ▼                   │
┌────────┐  ┌──────────────┐               │
│ Build  │  │ Registration │               │
│ UI     │  │ API Endpoint │               │
└───┬────┘  └──────┬───────┘               │
    │              │                        │
    └──────┬───────┴────────────────────────┘
           │
           ▼
    ┌──────────────┐
    │ Integration  │
    │ & Testing    │
    └──────────────┘
```

**Critical Path**: Design Flow → DB Schema → API → Integration
**Parallel Work**: UI Design/Build can happen alongside DB/API with design contract

### Managing Dependencies

1. **Identify Early**: Map dependencies during breakdown
2. **Create Contracts**: API specifications, design mockups
3. **Stub/Mock**: Use mocks to enable parallel work
4. **Communicate**: Flag blockers immediately
5. **Adjust**: Re-prioritize when dependencies change

## Estimation Techniques

### Story Points (Relative Sizing)

Compare stories to each other, not to time.

**Reference Story** (3 points): "Add to Cart" button
- Well understood
- Moderate complexity
- Clear requirements

**Other Stories**:
- Remove from cart (2 points): Similar but simpler
- Update cart quantity (2 points): Similar complexity
- Checkout flow (8 points): Much more complex
- Simple UI tweak (1 point): Trivial compared to reference

**Fibonacci Sequence**: 1, 2, 3, 5, 8, 13
- Forces binary thinking (roughly 2x complexity each step)
- Acknowledges uncertainty at larger sizes
- 13+ means "too large, break it down"

### T-shirt Sizing

Simpler, coarser estimation:
- **XS**: Couple hours, no unknowns
- **S**: 1-2 days, straightforward
- **M**: 3-5 days, moderate complexity
- **L**: 1-2 weeks, complex or unknowns
- **XL**: Multiple weeks, needs breakdown

Use for early estimation before detailed planning.

### Three-Point Estimation

For critical features, estimate best/likely/worst case:

**Formula**: (Best + 4×Likely + Worst) / 6

**Example**: Payment integration
- Best: 5 days (everything goes perfectly)
- Likely: 10 days (normal development)
- Worst: 20 days (integration issues, vendor delays)
- Estimate: (5 + 40 + 20) / 6 = 10.8 days

Provides more realistic timelines for complex work.

### Bucketing

Group similar-sized stories quickly:

**Small Bucket**: 1-2 points (trivial, quick wins)
**Medium Bucket**: 3-5 points (normal stories)
**Large Bucket**: 8-13 points (epics, need breakdown)

Fast way to prioritize and plan sprints.

## Estimation Best Practices

### 1. Let the Team Estimate

The people doing the work estimate the work.
- Developers estimate development effort
- Designers estimate design effort
- Product managers provide context, not estimates

### 2. Estimate as a Team

Use Planning Poker or similar techniques:
- Diverse perspectives reduce bias
- Discussion uncovers unknowns
- Consensus builds commitment

### 3. Base Estimates on Past Velocity

Track team velocity (story points completed per sprint):
- Sprint 1: 18 points
- Sprint 2: 22 points
- Sprint 3: 20 points
- Average: 20 points per sprint

Use average for planning future sprints.

### 4. Include Everything in Estimates

Don't just estimate coding time. Include:
- Code reviews
- Testing
- Bug fixes
- Deployment
- Documentation
- Meetings and communication

A 1-day coding task might be 2-3 days total effort.

### 5. Re-estimate When Learning

As you learn more during development:
- Update estimates
- Communicate changes
- Adjust scope or timeline
- Don't hide bad news

### 6. Avoid False Precision

"5.3 days" is false precision. Use ranges:
- "3-5 days" acknowledges uncertainty
- "2 weeks with high uncertainty" sets expectations

### 7. Estimate Uncertainty Separately

Rate confidence in estimates:
- High confidence: 80-100% (well understood)
- Medium confidence: 50-80% (some unknowns)
- Low confidence: <50% (spike needed)

## Capacity Planning

### Calculate Team Capacity

**Example**: 2-week sprint, 5-person team

**Nominal Capacity**: 5 people × 10 days = 50 person-days

**Adjusted Capacity**:
- Meetings/ceremonies: -10% (5 days)
- Code reviews: -10% (5 days)
- Support/bug fixes: -10% (5 days)
- Context switching: -10% (5 days)
- Actual capacity: 30 person-days

**Rule of Thumb**: 60-70% of nominal time is productive development time.

### Plan Sprint Commitment

Based on historical velocity (story points per sprint):
- Average velocity: 25 points
- Sprint goal: 20-25 points (leave buffer)
- Stretch goals: 5-10 points (if time permits)

**Never commit to**:
- 100% capacity (no buffer for unknowns)
- More than historical velocity
- Work without team agreement

## Risk Assessment in Estimation

### Identify Risk Factors

**Technical Risks**:
- New technology or framework
- Third-party dependencies
- Complex integrations
- Performance requirements

**Knowledge Risks**:
- Team unfamiliar with domain
- Unclear requirements
- Missing specifications

**Dependency Risks**:
- Waiting on other teams
- External vendor delays
- Regulatory approvals

### Risk-Adjusted Estimates

Add buffers based on risk:

**Low Risk**: No buffer
- Well understood
- Done similar work before
- All dependencies clear

**Medium Risk**: +25-50% buffer
- Some unknowns
- New but documented technology
- Dependencies mostly clear

**High Risk**: +100% buffer or spike first
- Many unknowns
- Experimental technology
- Complex dependencies

**Example**:
- Base estimate: 5 days
- Risk level: Medium
- Adjusted estimate: 7 days (5 × 1.4)

## Task Templates

### Frontend Task Template

```markdown
## Task: [Component/Feature Name]

**Description**: Brief description of what needs to be built

**Acceptance Criteria**:
- [ ] Component renders correctly
- [ ] Handles user interactions
- [ ] Responsive on mobile/tablet/desktop
- [ ] Accessible (keyboard nav, screen reader)
- [ ] Error states handled
- [ ] Loading states shown

**Technical Details**:
- Technology: React/Vue/Angular
- Dependencies: [list libraries]
- API endpoints: [list APIs used]
- Design: [link to mockups]

**Estimate**: X days / Y story points

**Dependencies**: [list blockers]
```

### Backend Task Template

```markdown
## Task: [API Endpoint Name]

**Description**: Brief description of endpoint functionality

**Acceptance Criteria**:
- [ ] Endpoint implemented and working
- [ ] Request/response validated
- [ ] Error handling implemented
- [ ] Authentication/authorization applied
- [ ] Unit tests written and passing
- [ ] API documentation updated

**Technical Details**:
- Method: GET/POST/PUT/DELETE
- Path: /api/resource
- Request format: [JSON schema]
- Response format: [JSON schema]
- Database: [tables affected]

**Estimate**: X days / Y story points

**Dependencies**: [list blockers]
```

## Real-World Example: Social Media Post Feature

### Epic Breakdown

**Epic**: Create and Share Posts

### User Stories (Vertical Slices)

**Story 1: Text Post** (MVP)
```
As a user, I want to create text posts,
So I can share my thoughts with followers.

Tasks:
├── Backend
│   ├── Create posts table schema (0.5 days)
│   ├── POST /api/posts endpoint (1 day)
│   ├── GET /api/posts endpoint (0.5 days)
│   └── Unit tests (0.5 days)
├── Frontend
│   ├── Create post form component (1 day)
│   ├── Post feed component (1 day)
│   ├── Integration with API (0.5 days)
│   └── Component tests (0.5 days)
└── Total: 5.5 days → 8 story points
```

**Story 2: Photo Post**
```
As a user, I want to attach photos to posts,
So I can share visual moments.

Tasks:
├── Backend
│   ├── File upload service integration (2 days)
│   ├── Image processing (resize, optimize) (2 days)
│   ├── Update posts table for images (0.5 days)
│   └── Tests (1 day)
├── Frontend
│   ├── Image upload component (2 days)
│   ├── Image preview (1 day)
│   ├── Display images in feed (1 day)
│   └── Tests (0.5 days)
└── Total: 10 days → 13 story points
```

**Story 3: Post Privacy**
```
As a user, I want to control who sees my posts,
So I can share privately or publicly.

Tasks:
├── Backend
│   ├── Privacy model implementation (1 day)
│   ├── Authorization logic (2 days)
│   ├── Update API endpoints (1 day)
│   └── Tests (1 day)
├── Frontend
│   ├── Privacy selector UI (1 day)
│   ├── Privacy indicator on posts (0.5 days)
│   └── Tests (0.5 days)
└── Total: 7 days → 8 story points
```

### Dependency Map

```
Story 1 (Text Post) - MUST complete first (foundation)
    ↓
    ├─→ Story 2 (Photo Post) - depends on Story 1
    │
    └─→ Story 3 (Privacy) - depends on Story 1, can parallel with Story 2
```

**Sprint Plan**:
- Sprint 1: Story 1 (8 points) + Story 3 start
- Sprint 2: Story 3 complete + Story 2 (21 points total)

## Common Pitfalls

### 1. Breaking Down Too Early

**Problem**: Detailed task breakdown months in advance
**Solution**: Just-in-time breakdown (1-2 sprints ahead)

### 2. Not Breaking Down Enough

**Problem**: Stories that take full sprint (8+ points)
**Solution**: Split until stories fit comfortably in sprint

### 3. Horizontal Slicing

**Problem**: Separating frontend/backend into different stories
**Solution**: Vertical slices that deliver user value

### 4. Ignoring Dependencies

**Problem**: Planning parallel work with hidden dependencies
**Solution**: Map dependencies explicitly during breakdown

### 5. Optimistic Estimation

**Problem**: Best-case estimates without buffers
**Solution**: Use historical data, account for risks

### 6. Estimating in Hours for Large Work

**Problem**: Estimating large features in hours (100+ hours)
**Solution**: Use story points for relative sizing

### 7. Not Updating Estimates

**Problem**: Original estimates never revised as you learn
**Solution**: Re-estimate during development, communicate changes

## Summary

**Effective Task Breakdown**:
1. Start with user journeys
2. Create vertical slices (user value)
3. Identify dependencies explicitly
4. Estimate collaboratively with team
5. Use relative sizing (story points)
6. Include buffers for risks
7. Update as you learn

**Remember**: The goal is not perfect estimation, but shared understanding and realistic planning. Breakdown and estimation are conversations that align the team on scope, complexity, and priorities.

---

See `assets/templates/planning/` for ready-to-use templates:
- `epic-template.md` - Epic breakdown template
- `milestone-plan.md` - Milestone planning with task breakdowns

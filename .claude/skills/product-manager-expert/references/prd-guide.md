# Product Requirements Document (PRD) Guide

A comprehensive guide to writing effective Product Requirements Documents that align teams and drive successful product development.

## What is a PRD?

A Product Requirements Document (PRD) is the single source of truth for what you're building, why you're building it, who it's for, and how success is measured. It bridges strategy and execution, translating business goals into actionable product requirements.

## Why PRDs Matter

**For Engineering**:
- Clear scope and requirements
- Understanding of user context
- Technical constraints identified
- Reduces back-and-forth questions

**For Design**:
- User needs and pain points
- Success criteria for solutions
- Edge cases to consider
- Context for design decisions

**For Stakeholders**:
- Visibility into product plans
- Opportunity to provide input
- Clear success metrics
- Timeline expectations

**For Product**:
- Documented decisions
- Shared understanding
- Reference during development
- Foundation for future iterations

## PRD Structure

### 1. Executive Summary

**Purpose**: One-paragraph overview readable by anyone in the company.

**What to Include**:
- Problem being solved
- Proposed solution
- Target users
- Expected impact
- Timeline

**Example**:
```
We're building a wishlist feature for our e-commerce platform to allow
customers to save items for later purchase. Currently, 40% of browsing
sessions end without purchase, and user research shows customers often
want to save items to compare or wait for sales. This feature will enable
customers to bookmark products, reducing drop-off and increasing return
visits. We expect to increase 30-day retention by 15% and revenue per
user by 8%. Target launch: Q2 2024.
```

### 2. Background and Context

**Purpose**: Provide context for why this work matters now.

**What to Include**:
- Business context (strategic goals, market conditions)
- User context (pain points, current behavior)
- Competitive landscape
- Previous attempts or related work
- Links to supporting documents

**Example**:
```
## Background

Our Q1 OKR is to increase customer retention from 35% to 50%. Analysis
of churned users shows that 60% never made a second purchase, and exit
surveys indicate they "found it, but weren't ready to buy."

Competitors like Amazon and Etsy have wishlist features that drive
return visits. Hotjar recordings show users opening products in multiple
tabs to compare—a behavior that indicates intent to save for later.

We tested a simple "Save for Later" prototype with 50 users in December.
78% used the feature, and saved users returned 2.3x more often than
non-saved users.
```

### 3. Problem Statement

**Purpose**: Define the problem you're solving.

**What to Include**:
- Who has the problem
- What the problem is
- Why it matters (impact)
- How we know it's a problem (evidence)
- What happens if we don't solve it

**Framework**: Use the format:
```
[User type] needs to [accomplish something] but currently [pain point]
which causes [negative outcome].
```

**Example**:
```
## Problem Statement

Our customers need to keep track of products they're interested in but
aren't ready to purchase immediately. Currently, they have no way to
save items within our platform, which causes them to lose track of
products or use external tools like screenshots or bookmarks.

**Evidence**:
- 40% of browsing sessions end with no purchase
- Support receives 50+ requests per month for "wishlist" or "save" feature
- User interviews (15/20 participants) mentioned wanting to save items
- Competitors all have this feature

**Impact of Not Solving**:
- Lost sales as users forget items they wanted
- Reduced return visits
- Competitive disadvantage
- Lower customer satisfaction (NPS impact)
```

### 4. Goals and Success Metrics

**Purpose**: Define what success looks like.

**What to Include**:
- Business goals
- User goals
- Success metrics (with baseline and target)
- Timeline for measurement
- Leading and lagging indicators

**Example**:
```
## Goals

**Business Goals**:
1. Increase 30-day retention from 35% to 50%
2. Increase revenue per user by 8%
3. Reduce customer acquisition cost by improving retention

**User Goals**:
1. Easily save products for later consideration
2. Quickly access saved items
3. Get notified of price drops or low stock

## Success Metrics

**Primary Metrics** (measure after 30 days):
- Wishlist adoption: 30% of active users create a wishlist
- Return visit rate: Users with wishlists return 2x more often
- Conversion rate: 25% of wishlisted items purchased within 30 days
- Retention: 30-day retention increases from 35% to 45%+

**Secondary Metrics**:
- Average wishlist size: 5-15 items
- Wishlist engagement: Users check wishlist 3+ times before purchase
- Email CTR: 15% click-through on wishlist notification emails

**Leading Indicators** (week 1):
- 20% of users click "Add to Wishlist" button
- Average time to first wishlist add: <5 minutes after signup
```

### 5. Target Users and Personas

**Purpose**: Define who you're building for.

**What to Include**:
- Primary persona (core user)
- Secondary personas
- User characteristics
- Motivations and pain points
- Use cases and scenarios

**Example**:
```
## Target Users

**Primary Persona: Sarah, the Considerate Shopper**

Demographics:
- Age: 28-45
- Income: $50-100K
- Shopping frequency: 2-3 times per month
- Average order value: $75

Characteristics:
- Researches before buying
- Price-conscious, waits for sales
- Browses during commute, buys from desktop
- Values recommendations

Pain Points:
- Loses track of items she wanted
- Misses sales on items she was considering
- Overwhelmed by too many choices
- Wants to compare before deciding

Goals:
- Find the perfect item at the right price
- Avoid buyer's remorse
- Discover new products

Quote: "I spend more time deciding what to buy than actually buying.
I need a way to keep track of what I'm considering without committing yet."

**Secondary Persona: Mike, the Gift Buyer**

Demographics:
- Age: 30-50
- Shopping for others
- Seasonal spikes (holidays, birthdays)

Pain Points:
- Forgets gift ideas when birthdays approach
- Needs to coordinate with family members
- Wants to stay within budget

Use Case: Creates wishlists for each family member throughout the year,
shares with spouse to coordinate, purchases when occasion arrives.
```

### 6. User Journeys and Use Cases

**Purpose**: Describe how users will interact with the feature.

**What to Include**:
- Primary use cases
- User flows (with diagrams)
- Key touchpoints
- Entry and exit points

**Example**:
```
## Primary Use Cases

**Use Case 1: Browse and Save**
1. User browses product catalog
2. Finds interesting product
3. Clicks "Add to Wishlist" button
4. Product added, confirmation shown
5. Continues browsing

**Use Case 2: Review Wishlist**
1. User clicks Wishlist icon in header
2. Views all saved items
3. Sorts/filters wishlist
4. Removes items no longer interested
5. Adds selected items to cart

**Use Case 3: Price Drop Notification**
1. User has items in wishlist
2. Item goes on sale
3. User receives email notification
4. Clicks through to product
5. Purchases item

## User Flow Diagram

[See Figma: wishlist-user-flow]

Key Steps:
- Entry Points: Product page, search results, recommendations
- Core Action: Add to wishlist (with visual feedback)
- Management: View, sort, filter, remove from wishlist
- Conversion: Add to cart, purchase
- Notifications: Email for price drops, low stock
```

### 7. Functional Requirements

**Purpose**: Define what the feature must do.

**What to Include**:
- Must-have (P0): Launch blockers
- Should-have (P1): Important but can come post-launch
- Nice-to-have (P2): Future enhancements
- User stories for each requirement
- Edge cases

**Example**:
```
## Functional Requirements

### Must-Have (P0) - Launch Blockers

**REQ-1: Add to Wishlist**
- As a user, I can add a product to my wishlist from the product page
- Button labeled "Add to Wishlist" with heart icon
- Click adds item, changes to "Added to Wishlist" with filled heart
- Animation confirms action
- Limited to logged-in users (prompt to login if guest)

**REQ-2: View Wishlist**
- As a user, I can view all my saved items in one place
- Accessible from header navigation (heart icon with count)
- Displays: product image, name, price, "Add to Cart" button
- Shows current price (updates if changed)
- Indicates if item out of stock

**REQ-3: Remove from Wishlist**
- As a user, I can remove items I'm no longer interested in
- Click "Remove" or "X" icon on wishlist page
- Confirmation: "Item removed from wishlist" with Undo option (5 sec)
- Clicking filled heart on product page also removes

**REQ-4: Add to Cart from Wishlist**
- As a user, I can add wishlist items directly to my shopping cart
- "Add to Cart" button on each wishlist item
- Clicking adds item to cart, shows cart notification
- Item remains in wishlist (not automatically removed)

### Should-Have (P1) - Post-Launch

**REQ-5: Price Drop Notifications**
- As a user, I receive email when wishlisted item goes on sale
- Automatic email when price drops >10%
- Email includes: product image, old/new price, "Shop Now" CTA
- Option to unsubscribe from specific item or all notifications

**REQ-6: Wishlist Organization**
- As a user, I can organize my wishlist into collections
- Create named lists (e.g., "Birthday Gift Ideas", "Home Office")
- Move items between lists
- Default "My Wishlist" for uncategorized

**REQ-7: Share Wishlist**
- As a user, I can share my wishlist with others
- Generate shareable link
- Recipients can view wishlist (read-only)
- Use case: Gift registries, coordinating with family

### Nice-to-Have (P2) - Future

**REQ-8: Stock Alerts**
- Email notification when out-of-stock item becomes available

**REQ-9: Price History**
- Show price history chart on product page for wishlisted items

**REQ-10: Wishlist Analytics**
- Personal dashboard showing saved items, price tracking, savings

## Edge Cases

**Item Deleted/Discontinued**:
- Show "No longer available" in wishlist
- Offer "Remove" or "Find Similar" options

**Price Increase**:
- Show updated price, no notification (only notify on drops)

**Guest User Adds to Wishlist**:
- Prompt to login/signup
- After auth, add item to wishlist (preserve intent)

**Wishlist Full** (if limit imposed):
- Show message: "Wishlist full (max 100 items). Remove items to add more."
```

### 8. Non-Functional Requirements

**Purpose**: Define how the feature should perform.

**What to Include**:
- Performance requirements
- Security and privacy
- Scalability
- Accessibility
- Browser/device support
- Compliance

**Example**:
```
## Non-Functional Requirements

### Performance
- Add to wishlist action completes in <200ms
- Wishlist page loads in <1 second
- Support 100 items per wishlist without performance degradation
- Optimistic UI updates (immediate feedback)

### Security
- Wishlists are private by default (only visible to owner)
- Shared wishlists use unique, non-guessable tokens
- Authentication required for all wishlist operations
- Rate limiting: Max 100 wishlist operations per minute per user

### Scalability
- Support 1M+ active wishlists
- Handle 10K+ wishlist operations per second
- Horizontal scaling for wishlist service

### Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation support (tab, enter to add/remove)
- Screen reader friendly (aria-labels, announcements)
- Color contrast ratios meet standards
- Focus indicators visible

### Browser Support
- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)
- Mobile: iOS Safari, Android Chrome

### Privacy
- GDPR compliance: Users can export/delete wishlist data
- Email notifications require explicit opt-in
- No wishlist data sold to third parties
```

### 9. Design and User Experience

**Purpose**: Define the look, feel, and interaction patterns.

**What to Include**:
- Design mockups or wireframes
- Interaction patterns
- Visual states
- Error messages
- Loading states
- Empty states

**Example**:
```
## Design

### Mockups
- [Figma: Wishlist Feature Designs]
- Product page with "Add to Wishlist" button
- Wishlist page (empty state, populated state)
- Email notification template

### Key Interactions

**Add to Wishlist Button**:
- States: Default, Hover, Active (in wishlist)
- Default: Outline heart icon, "Add to Wishlist"
- Active: Filled heart, "Added to Wishlist"
- Animation: Heart "pulse" on add

**Wishlist Page**:
- Grid layout (3 columns desktop, 1 column mobile)
- Product card: Image, name, price, "Add to Cart", "Remove"
- Empty state: Illustration + "Start adding items to your wishlist"

### Error States

**Item Out of Stock**:
- Greyed out image
- Badge: "Out of Stock"
- Options: "Remove" or "Notify When Available"

**Failed to Add**:
- Toast notification: "Couldn't add to wishlist. Try again."
- Retry button

**Network Error**:
- Inline message: "No internet connection. Changes will sync when online."
```

### 10. Technical Considerations

**Purpose**: Call out technical requirements and constraints.

**What to Include**:
- Architecture overview
- Database schema
- API specifications
- Integration points
- Technical risks
- Performance considerations

**Example**:
```
## Technical Considerations

### Architecture
- New "Wishlist Service" (Node.js microservice)
- PostgreSQL for wishlist storage
- Redis for caching frequently accessed wishlists
- Event-driven for email notifications (via SQS queue)

### Database Schema

```sql
CREATE TABLE wishlists (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) DEFAULT 'My Wishlist',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE wishlist_items (
    id UUID PRIMARY KEY,
    wishlist_id UUID NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    added_at TIMESTAMP DEFAULT NOW(),
    price_at_add DECIMAL(10,2),
    UNIQUE(wishlist_id, product_id)
);

CREATE INDEX idx_wishlist_user ON wishlists(user_id);
CREATE INDEX idx_wishlist_items_wishlist ON wishlist_items(wishlist_id);
```

### API Endpoints

**POST /api/wishlists**
- Create new wishlist
- Request: `{ "name": "string" }`
- Response: `{ "id": "uuid", "name": "string", "created_at": "timestamp" }`

**POST /api/wishlists/{id}/items**
- Add item to wishlist
- Request: `{ "product_id": "uuid" }`
- Response: `{ "id": "uuid", "product_id": "uuid", "added_at": "timestamp" }`

**GET /api/wishlists/{id}**
- Retrieve wishlist with items
- Response: Wishlist object with populated product details

**DELETE /api/wishlists/{id}/items/{item_id}**
- Remove item from wishlist
- Response: 204 No Content

### Integration Points
- **Product Service**: Fetch product details (price, availability, images)
- **User Service**: Authentication and user data
- **Email Service**: Price drop and stock notifications
- **Analytics**: Track wishlist events for metrics

### Technical Risks
- Product price changes: Need to track historical prices
- Product deletion: Handle gracefully in wishlist
- Scale: Wishlists can grow large, need pagination
- Real-time price updates: Balance freshness vs performance
```

### 11. Dependencies and Risks

**Purpose**: Identify what could block or derail the project.

**What to Include**:
- External dependencies
- Internal dependencies (teams, systems)
- Technical risks
- Business risks
- Mitigation strategies

**Example**:
```
## Dependencies

### External Dependencies
- **Email Service**: Required for price drop notifications (P1 requirement)
  - Risk: Vendor downtime affects notification delivery
  - Mitigation: Queue notifications, retry failed sends

### Internal Dependencies
- **Product Service**: Must expose price history API
  - Owner: Product Platform team
  - Timeline: Available by end of Sprint 1
  - Risk: Delay blocks price drop feature (P1)
  - Mitigation: Launch P0 features first, add price drops in v1.1

- **Design System**: Need heart icon component
  - Owner: Design Systems team
  - Timeline: Available now (already in library)
  - Risk: None

### Technical Risks

**Risk 1: Large Wishlist Performance**
- Description: Wishlists with 100+ items may load slowly
- Likelihood: Medium
- Impact: High (poor UX)
- Mitigation:
  - Implement pagination (20 items per page)
  - Lazy load product images
  - Cache wishlists in Redis

**Risk 2: Product Deletion Handling**
- Description: Products removed from catalog break wishlist links
- Likelihood: High (products discontinued regularly)
- Impact: Medium (broken experience)
- Mitigation:
  - Soft delete products, maintain data for wishlists
  - Show "No longer available" state
  - Offer "Find Similar" feature

### Business Risks

**Risk 1: Low Adoption**
- Description: Users don't use wishlist feature
- Likelihood: Low (validated in prototype)
- Impact: High (wasted effort, no metrics improvement)
- Mitigation:
  - Prominent placement of feature
  - Onboarding tooltip on first visit
  - A/B test different messaging

**Risk 2: Support Burden**
- Description: Feature introduces new support queries
- Likelihood: Medium
- Impact: Low (manageable)
- Mitigation:
  - Comprehensive FAQ
  - In-app help tooltips
  - Support team training before launch
```

### 12. Timeline and Milestones

**Purpose**: Set expectations for delivery.

**What to Include**:
- Key milestones
- Sprints or phases
- Launch date
- Dependencies timeline

**Example**:
```
## Timeline

**Target Launch**: End of Q2 2024 (June 30)

### Phase 1: Foundation (Sprints 1-2, Weeks 1-4)
- Week 1-2: Design finalization and API specification
- Week 3-4: Database setup, core API development
- Milestone: API endpoints functional, ready for frontend integration

### Phase 2: Core Features (Sprints 3-4, Weeks 5-8)
- Week 5-6: Frontend UI development (add/remove, view wishlist)
- Week 7-8: Testing, bug fixes, accessibility
- Milestone: P0 features complete and tested

### Phase 3: Alpha (Week 9)
- Internal testing with company employees
- Load testing and performance tuning
- Bug fixes
- Go/No-Go: May 10

### Phase 4: Beta (Weeks 10-11)
- Beta release to 10% of users
- Monitor metrics and feedback
- Iterate on issues
- Go/No-Go: May 24

### Phase 5: General Availability (Week 12)
- Full rollout to 100% of users
- Marketing campaign launch
- Monitor metrics
- Launch Date: June 14 (2 weeks buffer before quarter end)

### Post-Launch (Weeks 13+)
- P1 features: Price drop notifications, wishlist organization
- Iterate based on user feedback and data
```

### 13. Open Questions

**Purpose**: Document unresolved items that need decisions.

**What to Include**:
- Questions requiring stakeholder input
- Items requiring research
- Decisions pending data
- Owner and deadline for each

**Example**:
```
## Open Questions

1. **Wishlist Limit**: Should we impose a maximum number of items per wishlist?
   - Options: Unlimited, 100 items, 200 items
   - Owner: Product team
   - Decision by: End of Sprint 1
   - Leaning: 100 items (prevents abuse, manageable UX)

2. **Email Frequency**: How often should we send price drop notifications?
   - Options: Immediate, daily digest, weekly digest
   - Owner: Marketing team
   - Decision by: Sprint 3
   - Need: A/B test results

3. **Guest Wishlist**: Should we allow guest users to save items (browser-only)?
   - Trade-off: Better UX vs added complexity
   - Owner: Product & Engineering
   - Decision by: Sprint 2
   - Leaning: No for v1, revisit after launch data

4. **Social Sharing**: Do we allow sharing on social media (beyond link sharing)?
   - Owner: Product & Marketing
   - Decision by: Post-launch (P2 feature)
   - Need: User research on demand
```

### 14. Success Criteria and Launch Checklist

**Purpose**: Define what must be true before launching.

**Example**:
```
## Launch Criteria

### Go Criteria (Must be YES to launch)
- [ ] All P0 requirements implemented and tested
- [ ] Zero P0 bugs, <5 P1 bugs
- [ ] Load testing passed (10K concurrent users)
- [ ] Security review completed
- [ ] Accessibility audit passed (WCAG 2.1 AA)
- [ ] Support team trained
- [ ] FAQ and help documentation published
- [ ] Analytics tracking verified
- [ ] Email templates approved by Marketing
- [ ] Legal/Privacy review completed (GDPR compliance)

### No-Go Criteria (Any YES blocks launch)
- [ ] Critical bugs in production
- [ ] Performance degrades existing features
- [ ] Data loss or corruption risk
- [ ] Security vulnerabilities identified
- [ ] Accessibility issues blocking users

### Rollback Plan
- Feature flag: `feature.wishlist.enabled` (default: false)
- Can disable per-user, per-cohort, or globally
- Database rollback scripts prepared
- Communication plan for disabling feature if needed
```

## PRD Best Practices

### Writing Tips

1. **Start with the Problem**: Don't jump to solutions
2. **Use Visuals**: Diagrams, mockups, flows
3. **Be Specific**: Avoid vague terms like "user-friendly"
4. **Show, Don't Tell**: Use examples and scenarios
5. **Update as You Learn**: PRDs evolve, keep them current
6. **Link, Don't Duplicate**: Reference other docs (designs, research)

### Collaboration Tips

1. **Share Early**: Get feedback before finalizing
2. **Make it Accessible**: Use tools everyone can access
3. **Version Control**: Track changes, maintain history
4. **Async-Friendly**: Write for people reading later
5. **Open to Feedback**: Create space for comments and questions

### Common Mistakes to Avoid

1. **Too Vague**: Requirements must be specific and testable
2. **Solution-First**: Start with problem, not implementation
3. **No Metrics**: Must define success quantitatively
4. **Missing Edge Cases**: Consider error states and exceptions
5. **Not Updated**: PRD becomes stale as project evolves
6. **Overly Detailed**: Don't specify implementation details (that's for tech specs)
7. **No Prioritization**: Everything is P0 = nothing is P0

## PRD Templates

See `assets/templates/prds/` for ready-to-use templates:
- `prd-template.md` - Full PRD template
- `prd-one-pager.md` - Short-form PRD for small features
- `technical-spec-template.md` - Technical specification

## When to Write a PRD

**Write a PRD when**:
- Building new features or products
- Making significant changes to existing features
- Work involves multiple teams
- Unclear requirements need to be defined
- Stakeholder alignment is required

**Skip the PRD when**:
- Bug fixes (use bug reports)
- Small tweaks or UI polish
- Experiments or prototypes
- Internal tools with single developer

**Use PRD One-Pager when**:
- Smaller features (1-2 sprints)
- Lightweight alignment needed
- Quick iteration on existing feature

## Real-World Example

See the Wishlist PRD example above, which demonstrates:
- Clear problem statement backed by data
- Specific, measurable success metrics
- Prioritized requirements (P0/P1/P2)
- Edge cases and error states
- Technical considerations
- Risk identification and mitigation
- Timeline with milestones
- Launch criteria

This PRD could be used to:
- Align stakeholders on the feature
- Guide engineering implementation
- Track progress during development
- Evaluate success post-launch
- Onboard new team members

---

**Remember**: A PRD is a communication tool, not a contract. It should be clear enough to guide execution but flexible enough to adapt to learning. The best PRDs are living documents that evolve with the product.

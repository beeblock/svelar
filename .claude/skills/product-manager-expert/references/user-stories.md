# User Stories and Acceptance Criteria Guide

A comprehensive guide to writing effective user stories that translate product requirements into actionable development work.

## What is a User Story?

A user story is a short, simple description of a feature told from the perspective of the person who desires the new capability. It shifts focus from writing about requirements to talking about them.

**Format**:
```
As a [user type],
I want to [action],
So that [benefit].
```

## Why User Stories Matter

**Focus on Users**: Centers conversations on who we're building for
**Encourage Collaboration**: Stories are placeholders for conversation
**Enable Iteration**: Small, testable increments
**Support Estimation**: Sized appropriately for sprints
**Drive Testing**: Acceptance criteria = test cases

## INVEST Principles

Good user stories follow INVEST criteria:

### Independent
Stories should be able to be developed in any order without dependencies.

**Bad** (Dependent):
- Story 1: "As a user, I want to create an account"
- Story 2: "As a user, I want to verify my email address"

**Good** (Independent):
- Story: "As a user, I want to create an account and verify my email"
- Or split differently: "As a user, I want to login with social media" (different flow)

### Negotiable
Details are flexible and discussed during development, not fully specified upfront.

**Bad** (Too Specific):
- "As a user, I want a blue button in the top right corner labeled 'Submit' that uses Arial 14pt font"

**Good** (Negotiable):
- "As a user, I want to submit my form easily"
- Details discussed with design/engineering

### Valuable
Every story delivers value to users or the business.

**Bad** (No Clear Value):
- "As a developer, I want to refactor the authentication module"

**Good** (Clear Value):
- "As a user, I want faster login times so I can access my account quickly"
- (Refactoring is a task within this story)

### Estimable
Team can estimate the effort required.

**Bad** (Too Vague):
- "As a user, I want a better experience"

**Good** (Estimable):
- "As a user, I want to see my recent orders on the dashboard"

### Small
Stories should fit within one sprint (1-2 weeks).

**Bad** (Too Large - Epic):
- "As a user, I want a complete e-commerce shopping experience"

**Good** (Right-Sized):
- "As a user, I want to add items to my shopping cart"
- "As a user, I want to checkout and pay for my cart"

### Testable
Clear acceptance criteria enable testing.

**Bad** (Not Testable):
- "As a user, I want the site to be fast"

**Good** (Testable):
- "As a user, I want page load times under 2 seconds so I don't get frustrated"
- AC: "Given a standard product page, When I navigate to it, Then it loads in <2 seconds"

## Writing User Stories

### Structure

**Title**: Brief, descriptive (what the story is about)
**Description**: User story format (As a... I want... So that...)
**Acceptance Criteria**: Given-When-Then scenarios
**Definition of Done**: Quality gates
**Priority**: P0, P1, P2 or MoSCoW
**Estimate**: Story points or T-shirt size
**Dependencies**: Related stories or blockers
**Attachments**: Links to designs, mockups, specs

### Example: E-commerce Shopping Cart

**Title**: Add Item to Cart

**Description**:
```
As a logged-in customer,
I want to add products to my shopping cart,
So that I can purchase multiple items in a single transaction.
```

**Acceptance Criteria**:
```
Given I am viewing a product page,
When I click the "Add to Cart" button,
Then the item is added to my cart and I see a confirmation message.

Given I am viewing a product page,
When I click "Add to Cart",
Then the cart icon shows an updated item count.

Given I add a product that is already in my cart,
When I click "Add to Cart" again,
Then the quantity increases by 1.

Given the product is out of stock,
When I try to add it to my cart,
Then I see an error message: "This item is currently out of stock."

Given I am not logged in,
When I try to add an item to my cart,
Then I am prompted to log in or continue as guest.
```

**Definition of Done**:
- [ ] Code reviewed and approved
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Accessibility tested (keyboard navigation, screen reader)
- [ ] Tested on Chrome, Firefox, Safari
- [ ] Product owner accepted the work
- [ ] Documentation updated

**Priority**: P0 (Must have)

**Estimate**: 5 story points

**Dependencies**:
- Design mockups approved
- Product API endpoint available

**Attachments**:
- [Figma: Shopping Cart Designs]
- [API Spec: POST /api/cart/items]

## Acceptance Criteria

Acceptance criteria define the boundaries of a user story and are used to verify when work is complete.

### Given-When-Then Format

**Structure**:
```
Given [initial context/state],
When [action is taken],
Then [expected outcome].
```

**Benefits**:
- Clear preconditions (setup)
- Specific action (behavior)
- Measurable outcome (assertion)
- Maps directly to test cases

### Examples

**Login Story**:
```
Given I am on the login page,
When I enter valid credentials and click "Login",
Then I am redirected to my dashboard.

Given I am on the login page,
When I enter invalid credentials and click "Login",
Then I see an error message: "Invalid email or password."

Given I have entered my email,
When I click "Forgot Password",
Then I receive a password reset email within 5 minutes.
```

**Search Story**:
```
Given I am on the search page,
When I enter "red shoes" and press Enter,
Then I see a list of products matching my search.

Given I search for "xyzabc123" (non-existent product),
When the search completes,
Then I see "No results found" and suggested search terms.

Given I am viewing search results,
When I apply a price filter,
Then results update to show only items within the price range.
```

### Negative Test Cases

Always include unhappy paths and edge cases:

**Checkout Story**:
```
Given I have items in my cart,
When I proceed to checkout,
Then I see a summary of my order.

Given my cart is empty,
When I try to access checkout,
Then I am redirected to my cart with a message: "Your cart is empty."

Given I am on the payment page,
When my credit card is declined,
Then I see an error message and can try a different payment method.

Given I am entering payment information,
When my session expires,
Then I am prompted to log in again without losing my cart items.
```

## Story Mapping

Story mapping is a technique for organizing user stories into a coherent picture of a product.

### Story Map Structure

```
User Activities (High-level goals)
    ↓
User Tasks (Steps to achieve goals)
    ↓
User Stories (Specific features/functions)
    ↓
Tasks (Implementation details)
```

### Example: E-commerce Story Map

```
═══════════════════════════════════════════════════════════════
USER ACTIVITIES (Top level)
───────────────────────────────────────────────────────────────
Discover Products | Add to Cart | Checkout | Track Order
═══════════════════════════════════════════════════════════════

DISCOVER PRODUCTS
───────────────────────────────────────────────────────────────
Browse catalog    Search products    Filter results    View product
───────────────────────────────────────────────────────────────
• View categories • Enter keywords   • By price       • See images
• See featured    • Auto-suggest    • By brand       • Read description
• Sort products   • View results    • By rating      • Check reviews
                                                      • See availability

ADD TO CART
───────────────────────────────────────────────────────────────
Add item          Modify cart       Save for later
───────────────────────────────────────────────────────────────
• Click add       • Update quantity • Add to wishlist
• Select options  • Remove item     • Share item
• See confirmation• Apply coupon

CHECKOUT
───────────────────────────────────────────────────────────────
Enter info        Payment           Confirm order
───────────────────────────────────────────────────────────────
• Shipping address• Credit card     • Review summary
• Select shipping • PayPal          • Place order
• Guest/login     • Apple Pay       • Get confirmation

TRACK ORDER
───────────────────────────────────────────────────────────────
View status       Get updates       Manage order
───────────────────────────────────────────────────────────────
• Check status    • Email notify    • Cancel order
• Track shipment  • SMS alerts      • Return item
• See history     • Push notify     • Contact support
```

### Creating a Story Map

1. **Identify User Activities**: High-level goals (backbone)
2. **Break Down into Tasks**: Steps to complete each activity
3. **Write User Stories**: Specific features for each task
4. **Prioritize Horizontally**: Top rows are higher priority
5. **Group into Releases**: Draw lines for MVP, V1, V2

**MVP Line** (Minimum Viable Product):
- Browse catalog (basic)
- View product (basic)
- Add to cart
- Checkout (minimal)

**V1 Line** (First Full Release):
- Search products
- Filter results
- Modify cart
- Full checkout with options

**V2 Line** (Future Enhancements):
- Save for later / wishlist
- Track order
- Email notifications

## Story Splitting Techniques

When stories are too large (epics), split them into smaller, deliverable stories.

### Splitting Patterns

#### 1. By Workflow Steps

**Epic**: User registration
**Split**:
- Story 1: Enter email and password
- Story 2: Email verification
- Story 3: Profile completion

#### 2. By Business Rules

**Epic**: Apply discount codes
**Split**:
- Story 1: Percentage-based discounts
- Story 2: Fixed-amount discounts
- Story 3: Buy-one-get-one discounts

#### 3. By User Roles

**Epic**: Product management
**Split**:
- Story 1: Admin can create products
- Story 2: Editor can update products
- Story 3: Viewer can see products

#### 4. By Data Variations

**Epic**: Import user data
**Split**:
- Story 1: Import from CSV
- Story 2: Import from Excel
- Story 3: Import from JSON

#### 5. By CRUD Operations

**Epic**: Manage products
**Split**:
- Story 1: Create products
- Story 2: Read/view products
- Story 3: Update products
- Story 4: Delete products

#### 6. By Performance

**Epic**: Fast product search
**Split**:
- Story 1: Basic search (no performance optimization)
- Story 2: Indexed search (<1 second)
- Story 3: Autocomplete suggestions

#### 7. By Platforms

**Epic**: Mobile app shopping
**Split**:
- Story 1: iOS shopping cart
- Story 2: Android shopping cart
- Story 3: Web responsive shopping cart

## Story Prioritization

### MoSCoW Method

**Must Have**: Non-negotiable, product fails without it
- Core functionality
- Legal/compliance requirements
- Critical user needs

**Should Have**: Important but workarounds exist
- Significantly improves UX
- High user demand
- Competitive necessity

**Could Have**: Desirable but not necessary
- Nice-to-have features
- Low-impact improvements
- Can wait for future releases

**Won't Have**: Out of scope for this release
- Future considerations
- Explicitly not included
- Deferred to later versions

### Story Examples with MoSCoW

**E-commerce Checkout (MVP)**:

**Must Have**:
- Add item to cart
- View cart
- Enter shipping address
- Enter payment information
- Place order
- Receive order confirmation email

**Should Have**:
- Apply discount code
- Save shipping address
- Multiple payment methods (credit card + PayPal)
- Order summary preview

**Could Have**:
- Guest checkout (vs required login)
- Estimated delivery date
- Gift message option
- Save payment method for future

**Won't Have** (for MVP):
- Wishlist
- Product recommendations at checkout
- One-click checkout
- Subscribe and save option

## Epic Template

**Epic Title**: [High-level feature or capability]

**Epic Description**:
```
As a [user type],
I want to [high-level capability],
So that [business value].
```

**Business Value**:
- What problem does this solve?
- What is the expected impact?
- How does it align with company goals?

**User Stories** (Breakdown):
1. [Story 1 title]
2. [Story 2 title]
3. [Story 3 title]

**Acceptance Criteria** (Epic-level):
- High-level outcomes
- Success metrics
- Dependencies resolved

**Dependencies**:
- External systems
- Other epics
- Team dependencies

**Risks**:
- Technical risks
- Timeline risks
- Resource constraints

### Epic Example

**Epic Title**: Customer Wishlist

**Epic Description**:
```
As an e-commerce customer,
I want to save products I'm interested in to a wishlist,
So that I can purchase them later without having to search again.
```

**Business Value**:
- Increase return visit rate by 20%
- Improve 30-day retention by 15%
- Reduce cart abandonment by capturing intent early

**User Stories**:
1. As a user, I want to add products to my wishlist from product pages
2. As a user, I want to view all my saved wishlist items in one place
3. As a user, I want to remove items from my wishlist
4. As a user, I want to add wishlist items to my cart
5. As a user, I want to receive notifications when wishlist items go on sale
6. As a user, I want to organize wishlist items into collections
7. As a user, I want to share my wishlist with others

**MVP Stories** (Must Have): 1, 2, 3, 4
**V1 Stories** (Should Have): 5, 6
**V2 Stories** (Could Have): 7

**Acceptance Criteria** (Epic-level):
- 30% of active users adopt wishlist feature
- Users with wishlists return 2x more often
- 25% of wishlisted items purchased within 30 days

**Dependencies**:
- Design system heart icon component (available)
- Product service price history API (Sprint 1)
- Email notification service (available)

**Risks**:
- Low adoption if feature is not prominent
- Performance issues with large wishlists (100+ items)

## Story Estimation

### Story Points (Fibonacci)

Use relative sizing, not time-based estimates:
- **1 point**: Trivial, well-understood
- **2 points**: Simple, straightforward
- **3 points**: Moderate complexity
- **5 points**: Complex, some unknowns
- **8 points**: Very complex, significant unknowns
- **13 points**: Epic, needs to be broken down

### T-shirt Sizing

Simpler approach for early estimation:
- **XS**: Few hours of work
- **S**: 1-2 days
- **M**: 3-5 days (one sprint)
- **L**: 1-2 weeks (needs breaking down)
- **XL**: Multiple weeks (definitely an epic)

### Planning Poker

Team estimation technique:
1. Product owner reads story
2. Team asks clarifying questions
3. Each member selects card (1, 2, 3, 5, 8, 13)
4. Reveal cards simultaneously
5. Discuss differences (especially outliers)
6. Re-estimate until consensus

## Common Anti-Patterns

### Anti-Pattern 1: Technical Stories

**Bad**:
```
As a developer,
I want to refactor the user service,
So that the code is cleaner.
```

**Why Bad**: No user value, implementation detail

**Good**:
```
As a user,
I want faster page load times,
So that I can access content quickly.

Technical approach: Refactor user service for performance
```

### Anti-Pattern 2: Too Detailed

**Bad**:
```
As a user, I want to click a blue button labeled "Submit"
in the top right corner using Arial 14pt font that calls
the POST /api/submit endpoint with JSON payload containing
{name, email, message} fields.
```

**Why Bad**: Over-specifies implementation, not negotiable

**Good**:
```
As a user, I want to submit my contact form easily.

AC: User can submit form, sees confirmation, receives email
```

### Anti-Pattern 3: Vague

**Bad**:
```
As a user, I want a better experience.
```

**Why Bad**: Not testable, not estimable, no clear value

**Good**:
```
As a user, I want to see my recent orders on my dashboard,
So I can quickly reorder or track shipments.
```

### Anti-Pattern 4: Multiple Stories in One

**Bad**:
```
As a user, I want to create an account, verify my email,
complete my profile, upload a photo, connect social accounts,
and set notification preferences.
```

**Why Bad**: Too large, multiple concerns, not small

**Good**: Split into 6 separate stories, prioritize independently

## Real-World Examples

### Example 1: Social Media App

**Story**: Post a Photo

**Title**: Share photo post with followers

**Description**:
```
As a social media user,
I want to post photos to my feed,
So that I can share moments with my followers.
```

**Acceptance Criteria**:
```
Given I am on the create post screen,
When I select a photo from my gallery,
Then the photo is displayed in the post preview.

Given I have added a photo to my post,
When I add a caption and tap "Post",
Then my photo appears in my feed and my followers' feeds.

Given I am creating a post,
When I try to add more than 10 photos,
Then I see an error: "Maximum 10 photos per post."

Given I have poor internet connection,
When I attempt to post,
Then I see "Posting..." with progress indicator until complete.

Given my post upload fails,
When the error occurs,
Then I see an option to "Retry" without losing my caption.
```

**Priority**: P0 (core feature)
**Estimate**: 5 points
**Dependencies**: Image upload service, feed service API

### Example 2: SaaS Dashboard

**Story**: Filter Dashboard Data

**Title**: Filter analytics data by date range

**Description**:
```
As a business owner,
I want to filter my analytics dashboard by date range,
So that I can analyze performance over specific periods.
```

**Acceptance Criteria**:
```
Given I am viewing my analytics dashboard,
When I click the date range selector,
Then I see options: Last 7 days, Last 30 days, Last 90 days, Custom.

Given I select "Last 30 days",
When the filter is applied,
Then all dashboard charts update to show only last 30 days data.

Given I select "Custom" date range,
When I choose start date (Jan 1) and end date (Jan 31),
Then dashboard shows data for January only.

Given I select an invalid date range (end date before start date),
When I try to apply,
Then I see an error: "End date must be after start date."

Given I have applied a filter,
When I refresh the page,
Then the selected filter persists (stored in URL or localStorage).
```

**Priority**: P1 (important for analytics)
**Estimate**: 3 points
**Dependencies**: Charts library supports date filtering

## Templates

See `assets/templates/planning/` for ready-to-use templates:
- `user-story-template.md` - User story format
- `epic-template.md` - Epic breakdown template

---

**Remember**: User stories are conversation starters, not contracts. They should be detailed enough to estimate and build, but flexible enough to adapt based on learning during development. The best stories focus on user value and enable collaboration between product, design, and engineering.

# Code Review Summary

## Overview
**PR/Commit**: [Link or ID]
**Author**: [Author Name]
**Review Date**: [Date]
**Reviewer**: [Your Name]

## Summary
[Brief description of changes and overall assessment]

## Priority Issues

### Critical Issues (Must Fix Before Merge)
- [ ] [Issue 1 with file:line reference]
- [ ] [Issue 2 with file:line reference]

### Required Changes (Should Fix Before Merge)
- [ ] [Issue 1 with file:line reference]
- [ ] [Issue 2 with file:line reference]

### Important Suggestions (Address Soon)
- [ ] [Suggestion 1 with file:line reference]
- [ ] [Suggestion 2 with file:line reference]

## Detailed Feedback

### Architecture & Design
[Feedback on architectural decisions, layer separation, SOLID principles, etc.]

**Examples:**
- **[Critical]** Business logic in controller (OrderController.php:45-78)
  - Extract to CreateOrderAction in Domain layer
  - Implement proper DTO for data transfer

- **[Good]** Well-designed repository interface with clear separation of concerns

### Security
[Feedback on security vulnerabilities and concerns]

**Examples:**
- **[Critical]** SQL injection vulnerability (ReportController.php:89)
  - Use parameterized queries or Eloquent
  - Never concatenate user input into SQL

- **[Required]** Missing authorization check (OrderController.php:34)
  - Add policy check: `$this->authorize('delete', $order)`

### Testing
[Feedback on test coverage and quality]

**Examples:**
- **[Required]** Missing Pest tests for payment processing logic
  - Add unit tests for calculateTotal(), applyDiscount()
  - Add feature test for payment endpoint
  - Test error cases and edge conditions

- **[Good]** Excellent test coverage with clear, descriptive test names

### Performance
[Feedback on performance concerns]

**Examples:**
- **[Warning]** N+1 query detected (OrderController.php:56)
  - Use eager loading: `Order::with('items.product')->get()`

- **[Suggestion]** Consider caching expensive statistics query (DashboardController.php:23)

### Code Quality
[Feedback on clean code, readability, maintainability]

**Examples:**
- **[Minor]** Long method could be broken down (UserService.php:145-210)
  - Extract email sending logic to separate method
  - Extract validation logic to separate method

- **[Good]** Clear, descriptive variable names throughout

### Style & Conventions
[Minor feedback on formatting and Laravel conventions]

**Examples:**
- **[Minor]** Inconsistent use of array syntax
  - Use short array syntax `[]` consistently (config/app.php:12-45)

## Positive Highlights
[Call out well-designed code and good practices]

- ✅ Excellent use of Value Objects for Money and Email
- ✅ Clean separation between Domain and Infrastructure layers
- ✅ Comprehensive Pest test suite with descriptive names
- ✅ Proper use of Form Requests for validation

## Recommendations
[High-level recommendations for improvement]

1. Consider extracting common validation logic to custom validation rules
2. Implement caching strategy for frequently-accessed data
3. Document complex business logic with explanatory comments

## Overall Assessment
[Overall verdict: Approve, Approve with minor changes, Needs work, etc.]

**Recommendation**: [Approve / Request Changes / etc.]

[Additional context or next steps]

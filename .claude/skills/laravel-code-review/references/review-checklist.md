# Comprehensive Review Checklist

Use this checklist to ensure thorough code reviews. Not all items apply to every change - use judgment to focus on relevant areas.

## Table of Contents
- [Architecture & Design](#architecture--design)
- [Security](#security)
- [Business Logic](#business-logic)
- [Testing](#testing)
- [Performance](#performance)
- [Code Quality](#code-quality)
- [Laravel Conventions](#laravel-conventions)

## Architecture & Design

### Layer Separation
- [ ] Controllers are thin and delegate to Actions/Services
- [ ] Domain logic is in Domain layer, not Controllers or Models
- [ ] Eloquent models are in Infrastructure layer
- [ ] Domain entities don't depend on Eloquent
- [ ] No infrastructure concerns in domain code

### SOLID Principles
- [ ] **SRP**: Each class has a single responsibility
- [ ] **OCP**: Classes are open for extension, closed for modification
- [ ] **LSP**: Derived classes are substitutable for base classes
- [ ] **ISP**: Interfaces are focused and not bloated
- [ ] **DIP**: High-level modules depend on abstractions, not concretions

### Dependencies
- [ ] Dependencies injected through constructors
- [ ] Interfaces used for external services
- [ ] No circular dependencies between modules
- [ ] Domain layer depends only on other domain code
- [ ] Infrastructure implements domain interfaces

### Events & Messaging
- [ ] Domain events are immutable and past-tense
- [ ] Events carry all necessary data (no lazy loading)
- [ ] Listeners are queued for non-critical operations
- [ ] Event handlers don't contain business logic

## Security

### Input Validation
- [ ] All user input is validated
- [ ] Form Request classes used for complex validation
- [ ] Validation rules are appropriate and strict enough
- [ ] File uploads validate type, size, and content

### SQL Injection
- [ ] No raw SQL with unescaped user input
- [ ] Query builder or Eloquent used (parameterized queries)
- [ ] `whereRaw()` used carefully with bindings
- [ ] Dynamic table/column names properly validated

### XSS Prevention
- [ ] Output escaped in Blade templates (`{{ }}` not `{!! !!}`)
- [ ] `{!! !!}` only used for trusted, sanitized content
- [ ] JSON responses properly encoded
- [ ] User-generated content sanitized

### Authentication & Authorization
- [ ] Authentication required for protected routes
- [ ] Policies/gates used for authorization
- [ ] Authorization checked at right layer (controller/action)
- [ ] Password requirements are strong
- [ ] Passwords hashed with bcrypt/argon2

### CSRF & Session Security
- [ ] CSRF protection enabled for state-changing operations
- [ ] API routes use token-based authentication
- [ ] Session configuration is secure
- [ ] Cookies use secure flags in production

### Mass Assignment
- [ ] `$fillable` or `$guarded` defined on models
- [ ] Mass assignment protection appropriate for model
- [ ] Sensitive fields (password, role) protected

### Sensitive Data
- [ ] No credentials or secrets in code
- [ ] Environment variables used for configuration
- [ ] Sensitive data not logged
- [ ] API keys/tokens properly secured

## Business Logic

### Correctness
- [ ] Logic correctly implements requirements
- [ ] Calculations are accurate
- [ ] Domain rules enforced consistently
- [ ] Business constraints validated

### Edge Cases
- [ ] Empty/null inputs handled
- [ ] Boundary conditions tested
- [ ] Error conditions properly handled
- [ ] Invalid state transitions prevented

### Data Integrity
- [ ] Database transactions used where needed
- [ ] Referential integrity maintained
- [ ] Cascading deletes/updates appropriate
- [ ] No race conditions or deadlocks

### Error Handling
- [ ] Exceptions are appropriate and meaningful
- [ ] Error messages are helpful but not leak sensitive info
- [ ] Failed operations rolled back properly
- [ ] Errors logged with appropriate context

## Testing

### Coverage
- [ ] New code has tests
- [ ] Changed code has updated tests
- [ ] Critical paths fully tested
- [ ] Business logic thoroughly tested

### Pest Test Quality
- [ ] Test names clearly describe what's being tested
- [ ] Tests use AAA pattern (Arrange, Act, Assert)
- [ ] Each test focuses on one behavior
- [ ] Tests are readable and maintainable
- [ ] Appropriate Pest expectations used

### Test Types
- [ ] Unit tests for domain logic and entities
- [ ] Integration tests for repositories and services
- [ ] Feature tests for HTTP endpoints
- [ ] Edge cases and error conditions tested

### Test Data
- [ ] Factories used for test data
- [ ] Test data is realistic
- [ ] Tests don't depend on order of execution
- [ ] Database properly reset between tests

## Performance

### Database Queries
- [ ] No N+1 queries (use eager loading)
- [ ] Indexes exist for frequently queried columns
- [ ] Queries are efficient and selective
- [ ] Large datasets paginated

### Caching
- [ ] Cache used for expensive operations
- [ ] Cache invalidation strategy exists
- [ ] Cache keys are appropriate
- [ ] Cache expiration times set

### Resource Usage
- [ ] No memory leaks in long-running processes
- [ ] Large file processing streamed
- [ ] Queue used for time-consuming tasks
- [ ] Rate limiting on public endpoints

## Code Quality

### Naming
- [ ] Class names are nouns (Invoice, OrderRepository)
- [ ] Method names are verbs (calculateTotal, sendEmail)
- [ ] Variables reveal intent ($activeUsers not $users)
- [ ] Booleans in question form ($isActive, $hasAccess)

### Methods
- [ ] Methods are small and focused (under 20-30 lines)
- [ ] Single level of abstraction per method
- [ ] No flag arguments (split into separate methods)
- [ ] Command-query separation followed
- [ ] Maximum 3-4 parameters (use DTOs for more)

### Classes
- [ ] Classes are small and cohesive (under 200 lines)
- [ ] High cohesion (methods use most instance variables)
- [ ] Single responsibility
- [ ] No god objects

### Code Smells
- [ ] No long methods (extract smaller methods)
- [ ] No large classes (extract collaborators)
- [ ] No feature envy (move logic to data)
- [ ] No primitive obsession (use value objects)
- [ ] No shotgun surgery (consolidate changes)
- [ ] No divergent change (separate concerns)

### Documentation
- [ ] Complex logic has explanatory comments
- [ ] Public APIs documented
- [ ] No commented-out code
- [ ] PHPDoc blocks for non-obvious methods

### Types
- [ ] `declare(strict_types=1)` at top of file
- [ ] All parameters type-hinted
- [ ] All return types declared
- [ ] Union/intersection types used appropriately

## Laravel Conventions

### Structure
- [ ] Files in correct directories
- [ ] Namespace matches directory structure
- [ ] Class name matches filename
- [ ] One class per file

### Eloquent
- [ ] Relationships properly defined
- [ ] Query scopes used for reusable queries
- [ ] Accessors/mutators used appropriately
- [ ] Model events handled properly

### Migrations
- [ ] Migrations are reversible (`down()` implemented)
- [ ] Foreign keys have proper constraints
- [ ] Indexes on commonly queried columns
- [ ] Production-safe (no data loss)

### Routes
- [ ] Routes follow RESTful conventions
- [ ] Route names consistent and descriptive
- [ ] Route groups used for common middleware
- [ ] API routes in api.php, web routes in web.php

### Middleware
- [ ] Middleware focused on single concern
- [ ] Applied at appropriate level (route/group/global)
- [ ] Order of middleware correct
- [ ] Proper use of before/after middleware

### Service Providers
- [ ] Bindings in `register()` method
- [ ] Bootstrapping in `boot()` method
- [ ] Conditional loading where appropriate
- [ ] Deferred loading for performance

### Artisan Commands
- [ ] Clear, descriptive command names
- [ ] Proper arguments and options
- [ ] Help text provided
- [ ] Progress indication for long operations

import { describe, it, expect, beforeEach } from 'vitest';
import { QueryBuilder } from '../src/orm/QueryBuilder';

describe('QueryBuilder - SQL Generation', () => {
  describe('toSQL - Basic SELECT', () => {
    it('should generate basic SELECT all', () => {
      const qb = new QueryBuilder('users');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users');
      expect(bindings).toEqual([]);
    });

    it('should generate SELECT with specific columns', () => {
      const qb = new QueryBuilder('users');
      qb.select('id', 'name', 'email');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT id, name, email FROM users');
      expect(bindings).toEqual([]);
    });

    it('should handle DISTINCT', () => {
      const qb = new QueryBuilder('users');
      qb.distinct().select('role');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT DISTINCT role FROM users');
      expect(bindings).toEqual([]);
    });

    it('should handle addSelect', () => {
      const qb = new QueryBuilder('users');
      qb.select('id', 'name');
      qb.addSelect('email', 'phone');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT id, name, email, phone FROM users');
      expect(bindings).toEqual([]);
    });
  });

  describe('toSQL - WHERE clauses', () => {
    it('should generate single WHERE', () => {
      const qb = new QueryBuilder('users');
      qb.where('name', 'John');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE name = ?');
      expect(bindings).toEqual(['John']);
    });

    it('should generate WHERE with operator', () => {
      const qb = new QueryBuilder('users');
      qb.where('age', '>', 18);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE age > ?');
      expect(bindings).toEqual([18]);
    });

    it('should handle multiple WHERE (AND)', () => {
      const qb = new QueryBuilder('users');
      qb.where('status', 'active');
      qb.where('role', 'admin');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE status = ? AND role = ?');
      expect(bindings).toEqual(['active', 'admin']);
    });

    it('should handle OR WHERE', () => {
      const qb = new QueryBuilder('users');
      qb.where('role', 'admin');
      qb.orWhere('role', 'moderator');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE role = ? OR role = ?');
      expect(bindings).toEqual(['admin', 'moderator']);
    });

    it('should handle WHERE IN', () => {
      const qb = new QueryBuilder('users');
      qb.whereIn('status', ['active', 'pending']);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE status IN (?, ?)');
      expect(bindings).toEqual(['active', 'pending']);
    });

    it('should handle WHERE NOT IN', () => {
      const qb = new QueryBuilder('users');
      qb.whereNotIn('id', [1, 2, 3]);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE id NOT IN (?, ?, ?)');
      expect(bindings).toEqual([1, 2, 3]);
    });

    it('should handle WHERE NULL', () => {
      const qb = new QueryBuilder('users');
      qb.whereNull('deleted_at');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE deleted_at IS NULL');
      expect(bindings).toEqual([]);
    });

    it('should handle WHERE NOT NULL', () => {
      const qb = new QueryBuilder('users');
      qb.whereNotNull('email_verified_at');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE email_verified_at IS NOT NULL');
      expect(bindings).toEqual([]);
    });

    it('should handle WHERE BETWEEN', () => {
      const qb = new QueryBuilder('users');
      qb.whereBetween('age', [18, 65]);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE age BETWEEN ? AND ?');
      expect(bindings).toEqual([18, 65]);
    });

    it('should handle WHERE RAW', () => {
      const qb = new QueryBuilder('users');
      qb.whereRaw('age > ? AND status = ?', [18, 'active']);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE age > ? AND status = ?');
      expect(bindings).toEqual([18, 'active']);
    });
  });

  describe('toSQL - JOIN clauses', () => {
    it('should generate INNER JOIN', () => {
      const qb = new QueryBuilder('users');
      qb.join('posts', 'users.id', '=', 'posts.user_id');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users INNER JOIN posts ON users.id = posts.user_id');
      expect(bindings).toEqual([]);
    });

    it('should generate LEFT JOIN', () => {
      const qb = new QueryBuilder('users');
      qb.leftJoin('posts', 'users.id', '=', 'posts.user_id');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users LEFT JOIN posts ON users.id = posts.user_id');
      expect(bindings).toEqual([]);
    });

    it('should generate RIGHT JOIN', () => {
      const qb = new QueryBuilder('users');
      qb.rightJoin('posts', 'users.id', '=', 'posts.user_id');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users RIGHT JOIN posts ON users.id = posts.user_id');
      expect(bindings).toEqual([]);
    });

    it('should handle multiple joins', () => {
      const qb = new QueryBuilder('users');
      qb.join('posts', 'users.id', '=', 'posts.user_id');
      qb.leftJoin('comments', 'posts.id', '=', 'comments.post_id');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('INNER JOIN posts ON users.id = posts.user_id');
      expect(sql).toContain('LEFT JOIN comments ON posts.id = comments.post_id');
      expect(bindings).toEqual([]);
    });
  });

  describe('toSQL - ORDER BY', () => {
    it('should generate ORDER BY ASC', () => {
      const qb = new QueryBuilder('users');
      qb.orderBy('name', 'asc');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users ORDER BY name ASC');
      expect(bindings).toEqual([]);
    });

    it('should generate ORDER BY DESC', () => {
      const qb = new QueryBuilder('users');
      qb.orderBy('created_at', 'desc');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users ORDER BY created_at DESC');
      expect(bindings).toEqual([]);
    });

    it('should handle multiple ORDER BY', () => {
      const qb = new QueryBuilder('users');
      qb.orderBy('status', 'asc');
      qb.orderBy('name', 'desc');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users ORDER BY status ASC, name DESC');
      expect(bindings).toEqual([]);
    });

    it('should support latest() helper', () => {
      const qb = new QueryBuilder('users');
      qb.latest('updated_at');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users ORDER BY updated_at DESC');
      expect(bindings).toEqual([]);
    });

    it('should support oldest() helper', () => {
      const qb = new QueryBuilder('users');
      qb.oldest('created_at');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users ORDER BY created_at ASC');
      expect(bindings).toEqual([]);
    });
  });

  describe('toSQL - LIMIT and OFFSET', () => {
    it('should generate LIMIT', () => {
      const qb = new QueryBuilder('users');
      qb.limit(10);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users LIMIT 10');
      expect(bindings).toEqual([]);
    });

    it('should generate OFFSET', () => {
      const qb = new QueryBuilder('users');
      qb.offset(20);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users OFFSET 20');
      expect(bindings).toEqual([]);
    });

    it('should generate LIMIT and OFFSET', () => {
      const qb = new QueryBuilder('users');
      qb.limit(10).offset(20);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users LIMIT 10 OFFSET 20');
      expect(bindings).toEqual([]);
    });

    it('should support take() alias for limit', () => {
      const qb = new QueryBuilder('users');
      qb.take(15);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users LIMIT 15');
      expect(bindings).toEqual([]);
    });

    it('should support skip() alias for offset', () => {
      const qb = new QueryBuilder('users');
      qb.skip(50);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users OFFSET 50');
      expect(bindings).toEqual([]);
    });
  });

  describe('toSQL - GROUP BY and HAVING', () => {
    it('should generate GROUP BY', () => {
      const qb = new QueryBuilder('users');
      qb.select('role', 'COUNT(*) as count').groupBy('role');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('GROUP BY role');
      expect(bindings).toEqual([]);
    });

    it('should handle multiple GROUP BY', () => {
      const qb = new QueryBuilder('users');
      qb.groupBy('role', 'status');
      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('GROUP BY role, status');
      expect(bindings).toEqual([]);
    });

    it('should generate HAVING', () => {
      const qb = new QueryBuilder('users');
      qb.groupBy('role').having('count', '>', 5);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('GROUP BY role');
      expect(sql).toContain('HAVING count > ?');
      expect(bindings).toContain(5);
    });

    it('should handle GROUP BY with WHERE', () => {
      const qb = new QueryBuilder('users');
      qb.where('status', 'active')
        .groupBy('role')
        .having('count', '>=', 10);
      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('WHERE status = ?');
      expect(sql).toContain('GROUP BY role');
      expect(sql).toContain('HAVING count >= ?');
      expect(bindings).toEqual(['active', 10]);
    });
  });

  describe('toSQL - Complex queries', () => {
    it('should generate a complex query', () => {
      const qb = new QueryBuilder('users');
      qb.select('users.id', 'users.name', 'COUNT(posts.id) as post_count')
        .join('posts', 'users.id', '=', 'posts.user_id')
        .where('users.status', 'active')
        .where('users.deleted_at', 'IS', null)
        .groupBy('users.id')
        .having('post_count', '>', 5)
        .orderBy('post_count', 'desc')
        .limit(10);

      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('SELECT users.id, users.name, COUNT(posts.id) as post_count');
      expect(sql).toContain('FROM users');
      expect(sql).toContain('INNER JOIN posts');
      expect(sql).toContain('WHERE users.status = ? AND users.deleted_at IS null');
      expect(sql).toContain('GROUP BY users.id');
      expect(sql).toContain('HAVING post_count > ?');
      expect(sql).toContain('ORDER BY post_count DESC');
      expect(sql).toContain('LIMIT 10');

      expect(bindings).toEqual(['active', 5]);
    });

    it('should generate pagination query', () => {
      const page = 2;
      const perPage = 15;
      const offset = (page - 1) * perPage;

      const qb = new QueryBuilder('users');
      qb.where('active', true)
        .orderBy('created_at', 'desc')
        .limit(perPage)
        .offset(offset);

      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('WHERE active = ?');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT 15');
      expect(sql).toContain('OFFSET 15');

      expect(bindings).toEqual([true]);
    });

    it('should generate filtered and sorted query', () => {
      const qb = new QueryBuilder('products');
      qb.select('id', 'name', 'price')
        .where('category', 'electronics')
        .where('price', '<', 1000)
        .whereIn('brand', ['Apple', 'Samsung'])
        .orderBy('price', 'asc')
        .orderBy('name', 'asc')
        .limit(20);

      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('WHERE category = ? AND price < ? AND brand IN (?, ?)');
      expect(sql).toContain('ORDER BY price ASC, name ASC');
      expect(sql).toContain('LIMIT 20');

      expect(bindings).toEqual(['electronics', 1000, 'Apple', 'Samsung']);
    });
  });

  describe('toSQL - Edge cases', () => {
    it('should handle empty select with wildcard', () => {
      const qb = new QueryBuilder('users');
      qb.select();
      const { sql } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users');
    });

    it('should handle WHERE with operators', () => {
      const qb = new QueryBuilder('users');
      qb.where('id', '!=', 1);
      qb.where('created_at', '>=', '2024-01-01');
      qb.where('status', '<>', 'deleted');

      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('id != ?');
      expect(sql).toContain('created_at >= ?');
      expect(sql).toContain('status <> ?');

      expect(bindings).toEqual([1, '2024-01-01', 'deleted']);
    });

    it('should handle numbers and null in bindings', () => {
      const qb = new QueryBuilder('users');
      qb.where('age', 25);
      qb.where('score', 100.5);
      qb.where('data', null);

      const { sql, bindings } = qb.toSQL();

      expect(bindings).toEqual([25, 100.5, null]);
    });

    it('should handle special characters in table/column names', () => {
      const qb = new QueryBuilder('user_accounts');
      qb.select('user_id', 'account_name');
      qb.where('is_active', true);

      const { sql, bindings } = qb.toSQL();

      expect(sql).toContain('user_accounts');
      expect(sql).toContain('user_id');
      expect(sql).toContain('account_name');
    });

    it('should handle zero values', () => {
      const qb = new QueryBuilder('items');
      qb.where('quantity', 0);
      qb.where('discount', 0.0);

      const { sql, bindings } = qb.toSQL();

      expect(bindings).toEqual([0, 0.0]);
    });
  });

  describe('clone and modifications', () => {
    it('should clone builder and allow independent modifications', () => {
      const qb1 = new QueryBuilder('users');
      qb1.where('role', 'admin');

      const qb2 = qb1.clone();
      qb2.where('status', 'active');

      const { sql: sql1 } = qb1.toSQL();
      const { sql: sql2 } = qb2.toSQL();

      expect(sql1).not.toBe(sql2);
      expect(sql1).toContain('WHERE role = ?');
      expect(sql1).not.toContain('status');

      expect(sql2).toContain('WHERE role = ? AND status = ?');
    });
  });

  describe('SQL safety', () => {
    it('should use parameterized queries to prevent SQL injection', () => {
      const qb = new QueryBuilder('users');
      qb.where('name', "'; DROP TABLE users; --");

      const { sql, bindings } = qb.toSQL();

      expect(sql).toBe('SELECT * FROM users WHERE name = ?');
      expect(bindings).toEqual(["'; DROP TABLE users; --"]);
      expect(sql).not.toContain('DROP');
    });
  });
});

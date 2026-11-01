#include "yyb_pattern.h"

#include <cstddef>

namespace yyb {
namespace {

using NodePtr = std::shared_ptr<Pattern::Node>;
using Cont = std::function<bool(size_t)>;

NodePtr make_node(Pattern::Node::Kind k) {
  NodePtr n = std::make_shared<Pattern::Node>();
  n->kind = k;
  return n;
}

void add_class_digits(Pattern::Node& n) { n.ranges.push_back({u'0', u'9'}); }
void add_class_word(Pattern::Node& n) {
  n.ranges.push_back({u'0', u'9'});
  n.ranges.push_back({u'A', u'Z'});
  n.ranges.push_back({u'a', u'z'});
  n.singles.push_back(u'_');
}
void add_class_spaces(Pattern::Node& n) {
  const char16_t sp[] = {0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x00A0,
                         0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF};
  for (char16_t c : sp) n.singles.push_back(c);
  n.ranges.push_back({0x2000, 0x200A});
}

char16_t escaped_char(char16_t c) {
  switch (c) {
    case u'n': return u'\n';
    case u'r': return u'\r';
    case u't': return u'\t';
    case u'f': return u'\f';
    case u'v': return u'\v';
    case u'0': return u'\0';
    default: return c;
  }
}

struct Parser {
  const U16& p;
  size_t i = 0;
  bool bad = false;

  explicit Parser(const U16& pat) : p(pat) {}

  bool eof() const { return i >= p.size(); }
  char16_t peek() const { return i < p.size() ? p[i] : 0; }

  NodePtr parse_alt() {
    std::vector<NodePtr> alts;
    alts.push_back(parse_seq());
    while (!bad && !eof() && peek() == u'|') {
      i++;
      alts.push_back(parse_seq());
    }
    if (alts.size() == 1) return alts[0];
    NodePtr n = make_node(Pattern::Node::ALT);
    n->kids = alts;
    return n;
  }

  NodePtr parse_seq() {
    NodePtr n = make_node(Pattern::Node::SEQ);
    while (!bad && !eof() && peek() != u'|' && peek() != u')') {
      n->kids.push_back(parse_item());
    }
    return n;
  }

  NodePtr parse_item() {
    NodePtr atom = parse_atom();
    if (bad || eof()) return atom;
    char16_t c = peek();
    int mn = -1, mx = -1;
    if (c == u'?') { mn = 0; mx = 1; i++; }
    else if (c == u'*') { mn = 0; mx = -1; i++; }
    else if (c == u'+') { mn = 1; mx = -1; i++; }
    else if (c == u'{') {
      size_t save = i;
      i++;
      size_t a = i;
      while (!eof() && peek() >= u'0' && peek() <= u'9') i++;
      if (a == i) { bad = true; return atom; }
      int lo = 0;
      for (size_t k = a; k < i; k++) lo = lo * 10 + (int)(p[k] - u'0');
      int hi = lo;
      if (!eof() && peek() == u',') {
        i++;
        size_t b = i;
        while (!eof() && peek() >= u'0' && peek() <= u'9') i++;
        if (b == i) hi = -1;
        else { hi = 0; for (size_t k = b; k < i; k++) hi = hi * 10 + (int)(p[k] - u'0'); }
      }
      if (eof() || peek() != u'}') { i = save; bad = true; return atom; }
      i++;
      mn = lo; mx = hi;
    }
    if (mn < 0) return atom;
    NodePtr rep = make_node(Pattern::Node::REP);
    rep->min_rep = mn;
    rep->max_rep = mx;
    rep->kids.push_back(atom);
    return rep;
  }

  NodePtr parse_atom() {
    char16_t c = peek();
    if (c == u'(') {
      i++;
      if (!eof() && peek() == u'?') {
        if (i + 1 < p.size() && p[i + 1] == u':') { i += 2; }
        else { bad = true; return make_node(Pattern::Node::SEQ); }
      }
      NodePtr inner = parse_alt();
      if (eof() || peek() != u')') { bad = true; return inner; }
      i++;
      NodePtr g = make_node(Pattern::Node::GRP);
      g->kids.push_back(inner);
      return g;
    }
    if (c == u'[') return parse_class();
    if (c == u'\\') {
      i++;
      if (eof()) { bad = true; return make_node(Pattern::Node::SEQ); }
      char16_t e = p[i++];
      if (e == u'd' || e == u'D') {
        NodePtr n = make_node(Pattern::Node::CLS);
        add_class_digits(*n);
        n->negate = (e == u'D');
        return n;
      }
      if (e == u'w' || e == u'W') {
        NodePtr n = make_node(Pattern::Node::CLS);
        add_class_word(*n);
        n->negate = (e == u'W');
        return n;
      }
      if (e == u's' || e == u'S') {
        NodePtr n = make_node(Pattern::Node::CLS);
        add_class_spaces(*n);
        n->negate = (e == u'S');
        return n;
      }
      NodePtr n = make_node(Pattern::Node::LIT);
      n->lit = escaped_char(e);
      return n;
    }
    if (c == u'.') {
      i++;
      return make_node(Pattern::Node::ANY);
    }
    i++;
    NodePtr n = make_node(Pattern::Node::LIT);
    n->lit = c;
    return n;
  }

  NodePtr parse_class() {
    i++; /* '[' */
    NodePtr n = make_node(Pattern::Node::CLS);
    if (!eof() && peek() == u'^') { n->negate = true; i++; }
    while (!eof() && peek() != u']') {
      char16_t c = p[i];
      if (c == u'\\') {
        i++;
        if (eof()) { bad = true; return n; }
        char16_t e = p[i++];
        if (e == u'd') { add_class_digits(*n); continue; }
        if (e == u'w') { add_class_word(*n); continue; }
        if (e == u's') { add_class_spaces(*n); continue; }
        c = escaped_char(e);
      } else {
        i++;
      }
      /* 区间 a-z */
      if (!eof() && peek() == u'-' && i + 1 < p.size() && p[i + 1] != u']') {
        i++;
        char16_t hi = p[i];
        if (hi == u'\\') {
          i++;
          if (eof()) { bad = true; return n; }
          hi = escaped_char(p[i]);
        }
        i++;
        n->ranges.push_back({c, hi});
        continue;
      }
      n->singles.push_back(c);
    }
    if (eof() || peek() != u']') { bad = true; return n; }
    i++;
    return n;
  }
};

bool is_single_char_atom(const Pattern::Node* n) {
  if (!n) return false;
  return n->kind == Pattern::Node::LIT || n->kind == Pattern::Node::ANY ||
         n->kind == Pattern::Node::CLS;
}

bool consume_one(const Pattern::Node* n, const U16& s, size_t pos) {
  if (pos >= s.size()) return false;
  switch (n->kind) {
    case Pattern::Node::LIT: return s[pos] == n->lit;
    case Pattern::Node::ANY: return true;
    case Pattern::Node::CLS: return n->in_class(s[pos]);
    default: return false;
  }
}

bool match_node(const Pattern::Node* n, const U16& s, size_t pos, const Cont& k);

bool match_seq_items(const Pattern::Node* seq, size_t idx, const U16& s, size_t pos, const Cont& k) {
  if (idx >= seq->kids.size()) return k(pos);
  return match_node(seq->kids[idx].get(), s, pos, [&](size_t np) {
    return match_seq_items(seq, idx + 1, s, np, k);
  });
}

bool match_rep(const Pattern::Node* rep, const U16& s, size_t pos, const Cont& k) {
  const Pattern::Node* atom = rep->kids[0].get();
  const int maxr = (rep->max_rep < 0) ? (int)(s.size() + 1) : rep->max_rep;
  if (is_single_char_atom(atom)) {
    /* 单字符原子：迭代收集停止位，避免长串递归爆栈 */
    std::vector<size_t> stops;
    stops.push_back(pos);
    size_t p = pos;
    while ((int)stops.size() - 1 < maxr && consume_one(atom, s, p)) {
      p++;
      stops.push_back(p);
    }
    int kk = (int)stops.size() - 1;
    for (int c = kk; c >= rep->min_rep; c--) {
      if (k(stops[(size_t)c])) return true;
    }
    return false;
  }
  std::function<bool(size_t, int)> rec = [&](size_t p, int c) -> bool {
    if (c < maxr) {
      bool took = match_node(atom, s, p, [&](size_t np) {
        if (np == p) return false;
        return rec(np, c + 1);
      });
      if (took) return true;
    }
    if (c >= rep->min_rep) return k(p);
    return false;
  };
  return rec(pos, 0);
}

bool match_node(const Pattern::Node* n, const U16& s, size_t pos, const Cont& k) {
  switch (n->kind) {
    case Pattern::Node::LIT:
    case Pattern::Node::ANY:
    case Pattern::Node::CLS:
      if (consume_one(n, s, pos)) return k(pos + 1);
      return false;
    case Pattern::Node::GRP:
      return match_node(n->kids[0].get(), s, pos, k);
    case Pattern::Node::ALT:
      for (const NodePtr& kid : n->kids) {
        if (match_node(kid.get(), s, pos, k)) return true;
      }
      return false;
    case Pattern::Node::SEQ:
      return match_seq_items(n, 0, s, pos, k);
    case Pattern::Node::REP:
      return match_rep(n, s, pos, k);
  }
  return false;
}

} // namespace

bool Pattern::Node::in_class(char16_t c) const {
  bool hit = false;
  for (char16_t s : singles) {
    if (s == c) { hit = true; break; }
  }
  if (!hit) {
    for (const auto& r : ranges) {
      if (c >= r.first && c <= r.second) { hit = true; break; }
    }
  }
  return negate ? !hit : hit;
}

Pattern compile_pattern_u16(const U16& pat) {
  Parser ps(pat);
  Pattern out;
  NodePtr root = ps.parse_alt();
  if (ps.bad || root == nullptr) { out.valid = false; return out; }
  out.root = root;
  out.valid = true;
  return out;
}

Pattern compile_pattern(const std::string& utf8_pattern) {
  return compile_pattern_u16(utf8_to_u16(utf8_pattern));
}

bool Pattern::test(const U16& s) const {
  size_t ms = 0, me = 0;
  return search(s, 0, ms, me);
}

bool Pattern::search(const U16& s, size_t from, size_t& ms, size_t& me) const {
  if (!valid || !root) return false;
  for (size_t pos = from; pos <= s.size(); pos++) {
    size_t end = 0;
    bool ok = match_node(root.get(), s, pos, [&](size_t e) { end = e; return true; });
    if (ok) { ms = pos; me = end; return true; }
  }
  return false;
}

size_t Pattern::count(const U16& s) const {
  size_t n = 0, pos = 0, ms = 0, me = 0;
  while (pos <= s.size() && search(s, pos, ms, me)) {
    n++;
    if (me > ms) pos = me;
    else pos = ms + 1;
  }
  return n;
}

} // namespace yyb

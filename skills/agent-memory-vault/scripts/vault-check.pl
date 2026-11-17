#!/usr/bin/env perl
# vault-check.pl: check an agent memory vault for secrets and broken structure.
#
#   perl vault-check.pl <vault folder>
#
# Fails (exit 1) on:
#   - a secret-shaped value in any text file (keys, tokens, private keys, seed-phrase lines, keys in URLs)
#   - a file that must never be in a vault (.env, key files, wallet and seed files)
#   - a value-shaped cell in KEY-INDEX.md (it holds names and locations only)
#   - an unsigned line under "## Entries" in INBOX.md
#   - a missing front-door file, or a ROUTER.md over 8 KB
#   - a day log not named logs/<machine>/YYYY-MM-DD.md
#   - a [[wikilink]] that points at no note
# Warns (exit 0) on: notes over 50 KB, template placeholders left in.
#
# Prints file:line and the rule name. Never prints the matching text.
use strict;
use warnings;
use File::Find;
use File::Spec;

my $root = shift @ARGV or do { print STDERR "usage: perl vault-check.pl <vault folder>\n"; exit 2 };
-d $root or do { print STDERR "vault-check: $root is not a folder\n"; exit 2 };
$root =~ s{/+$}{};

my (@fail, @warn);
sub fail { push @fail, "$_[0]: $_[1]" }
sub warn_ { push @warn, "$_[0]: $_[1]" }

# --- secret-shaped values (the same families as the prepublish-leak-check skill) ---
my @RULES = (
  ['private key',        qr/-----BEGIN [A-Z ]*PRIVATE KEY/],
  ['api key',            qr/\b(?:sk-ant-[\w-]{10,}|sk-[A-Za-z0-9_-]{32,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xai-[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})/],
  ['network-prefixed project id', qr/\b(?:mainnet|preprod|preview|testnet)[A-Za-z0-9]{32}\b/],
  ['secret assignment',  qr/\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|SEED|MNEMONIC|PRIVATE_KEY)[A-Za-z0-9_]*\s*[=:]\s*["']?[A-Za-z0-9+\/_.-]{12,}/i],
  ['key in url',         qr/[?&](?:api[_-]?key|apikey|project_?id|access_token|auth|token|secret|key|sig|signature|password)=[^&\s"'<\$]{8,}/i],
  ['password in url',    qr{//[^/\s:@'"]+:[^@\s/'"<\$]{6,}@}],
  ['bearer token',       qr/Bearer\s+[A-Za-z0-9._~+\/-]{20,}/],
  ['json web token',     qr/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['64-hex value',       qr/\b[0-9a-f]{64}\b/i],
  ['seed phrase',        qr/(?:seed|mnemonic|recovery|secret)\s*(?:phrase|words)?\s*[:=]\s*(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}/i],
  ['seed phrase',        qr/^\s*(?:\d+[.)]?\s*)?(?:[a-z]{3,8}\s+){11}(?:(?:[a-z]{3,8}\s+){3}){0,4}[a-z]{3,8}\s*$/],
);
my $FORBIDDEN = qr{(?:^|/)(?:\.env[^/]*|[^/]*\.(?:pem|key|p12|pfx)|id_(?:rsa|ed25519|ecdsa)[^/]*|[^/]*(?:seed|mnemonic)[^/]*\.(?:txt|json|hex)|seed|mnemonic|[^/]*wallet[^/]*\.json|[^/]*credentials[^/]*\.(?:json|txt|csv))$}i;

# --- collect files ---
my (@files, %notes);
find({ no_chdir => 1, wanted => sub {
  my $p = $File::Find::name;
  if (-d $p) { $File::Find::prune = 1 if $p =~ m{/(?:\.git|\.obsidian|\.trash|node_modules)$}; return; }
  my $rel = File::Spec->abs2rel($p, $root);
  push @files, $rel;
} }, $root);
@files = sort @files;
for my $f (grep { /\.md$/ } @files) {
  (my $noext = $f) =~ s/\.md$//;
  my ($base) = $noext =~ m{([^/]+)$};
  $notes{lc $noext} = 1; $notes{lc $base} = 1;
}

# --- front door ---
for my $need (qw(ROUTER.md RULES.md CORE.md INBOX.md DECISIONS.md LESSONS.md KEY-INDEX.md HOME.md)) {
  fail($need, 'missing front-door file') unless -f "$root/$need";
}
if (-f "$root/ROUTER.md") {
  my $size = -s "$root/ROUTER.md";
  fail('ROUTER.md', "router is $size bytes (max 8192): move detail into a topic home") if $size > 8192;
}

# --- every file ---
for my $f (@files) {
  fail($f, 'file that must never be in a vault') if $f =~ $FORBIDDEN && $f !~ m{(?:^|/)\.gitignore$};
  my $path = "$root/$f";
  my $size = -s $path;
  open(my $fh, '<:raw', $path) or next;
  local $/; my $buf = <$fh>; close $fh;
  next if !defined $buf || index($buf, "\0") >= 0;    # binary
  warn_($f, 'note over 50 KB: split it or move the older part into archive/') if $f =~ /\.md$/ && $size > 50 * 1024;

  my @lines = split /\n/, $buf, -1;
  my $in_fence = 0; my $in_entries = 0; my $is_inbox = ($f eq 'INBOX.md'); my $is_keys = ($f eq 'KEY-INDEX.md');
  for my $i (0 .. $#lines) {
    my $line = $lines[$i]; my $where = "$f:" . ($i + 1);
    for my $r (@RULES) { if ($line =~ $r->[1]) { fail($where, $r->[0]); last } }
    next unless $f =~ /\.md$/;
    if ($line =~ /^\s*```/) { $in_fence = !$in_fence; next }
    warn_($where, 'template placeholder left in') if $line =~ /\{\{[A-Z]+\}\}/;
    next if $in_fence;
    (my $text = $line) =~ s/`[^`]*`//g;    # inline code is not a link and not an entry

    # wikilinks
    while ($text =~ /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g) {
      my $t = $1; $t =~ s/^\s+|\s+$//g; $t =~ s/\.md$//; $t =~ s{^\./}{};
      fail($where, 'wikilink to a note that does not exist') unless $notes{lc $t};
    }
    # inbox entries must be signed
    if ($is_inbox) {
      if ($line =~ /^##\s+Entries\s*$/) { $in_entries = 1; next }
      if ($line =~ /^##\s/) { $in_entries = 0; next }
      if ($in_entries && $line =~ /^\s*-\s+\S/ && $line !~ /—\s*[^\s()][^()]*\([^()]+\)\s*\|\s*\d{4}-\d{2}-\d{2}\s*$/) {
        fail($where, 'inbox entry not signed "— <agent> (<machine>) | YYYY-MM-DD"');
      }
    }
    # key index: names and locations only
    if ($is_keys && $line =~ /^\s*\|/ && $line !~ /^\s*\|[\s:|-]+\|?\s*$/) {
      for my $cell (split /\|/, $line) {
        $cell =~ s/`[^`]*`//g;    # `ENV_VAR_NAME` is a name, fine
        if ($cell =~ /(?<![\w\/.-])(?=[A-Za-z0-9+\/_=-]*\d)(?=[A-Za-z0-9+\/_=-]*[A-Za-z])[A-Za-z0-9+\/_=-]{20,}(?![\w\/.-])/) {
          fail($where, 'KEY-INDEX cell looks like a value, not a name or a place'); last;
        }
      }
    }
  }
}

# --- day logs ---
for my $f (grep { m{^logs/} } @files) {
  next if $f =~ m{^logs/README\.md$} || $f =~ m{^logs/inbox-archive/\d{4}-\d{2}\.md$} || $f =~ m{/archive/} || $f =~ m{/\.gitkeep$};
  fail($f, 'day log must be logs/<machine>/YYYY-MM-DD.md') unless $f =~ m{^logs/[a-z0-9][a-z0-9-]*/\d{4}-\d{2}-\d{2}\.md$};
}

print "warn  $_\n" for @warn;
print "FAIL  $_\n" for @fail;
my $n = scalar @files;
if (@fail) { print "vault-check: " . scalar(@fail) . " problem(s) in $n files\n"; exit 1 }
print "vault-check: clean ($n files" . (@warn ? ", " . scalar(@warn) . " warning(s)" : "") . ")\n";
exit 0;

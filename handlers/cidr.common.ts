/**
 * Splits a CIDR string into its address and prefix parts, rejecting malformed
 * input (missing "/", empty halves, or more than one "/").
 */
function splitCidr(cidr: string): [string, string] {
  const parts = cidr.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid CIDR format: ${cidr}`);
  }
  return [parts[0], parts[1]];
}

/**
 * Parses a CIDR prefix length, rejecting non-numeric or out-of-range values.
 * The `/^\d+$/` test also rules out negatives, "+3", whitespace, and trailing
 * garbage like "24abc" that parseInt would otherwise accept.
 */
function parsePrefix(prefixStr: string, max: number): number {
  if (!/^\d+$/.test(prefixStr)) {
    throw new Error(`Invalid CIDR prefix: "${prefixStr}". Must be an integer 0-${max}.`);
  }
  const prefix = Number(prefixStr);
  if (prefix > max) {
    throw new Error(`Invalid CIDR prefix: "${prefixStr}". Must be between 0 and ${max}.`);
  }
  return prefix;
}

/**
 * Builds a 32-bit network mask for the given IPv4 prefix length (1-32).
 * Not valid for prefix 0 — callers must special-case /0, because
 * `0xffffffff << 32` wraps to `<< 0` in JS.
 */
function ipv4Mask(prefix: number): number {
  return (0xffffffff << (32 - prefix)) >>> 0;
}

/**
 * Builds a 128-bit network mask for the given IPv6 prefix length (1-128):
 * `prefix` leading 1s followed by 0s.
 */
function ipv6Mask(prefix: number): bigint {
  return ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
}

/**
 * Converts an IPv4 string (e.g., "192.168.1.5") to a 32-bit unsigned integer.
 * Each octet is validated to be a 1-3 digit decimal number in the range 0-255,
 * which rejects overflow ("256.0.0.1"), negatives, empty octets ("192.168.1."),
 * and non-decimal forms ("0xff.0.0.1").
 */
function ipToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address format: ${ip}`);
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      throw new Error(`Invalid IPv4 octet "${part}" in ${ip}`);
    }
    const value = Number(part);
    if (value > 255) {
      throw new Error(`IPv4 octet out of range "${part}" in ${ip}`);
    }
    return value;
  });

  const octet0 = octets[0] || 0;
  const octet1 = octets[1] || 0;
  const octet2 = octets[2] || 0;
  const octet3 = octets[3] || 0;

  // Use >>> 0 to force the result into an unsigned 32-bit integer.
  return ((octet0 << 24) | (octet1 << 16) | (octet2 << 8) | octet3) >>> 0;
}

/**
 * Checks if an IPv4 address is within a given CIDR range.
 * @param ip - The IP address to check (e.g., "192.168.1.50")
 * @param cidr - The CIDR range (e.g., "192.168.1.0/24")
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = splitCidr(cidr);
  const prefix = parsePrefix(prefixStr, 32);

  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(rangeIp);

  // Handle edge case for /0 (matches everything). This must be handled before
  // building the mask, because `0xffffffff << 32` wraps to `<< 0` in JS.
  if (prefix === 0) return true;

  const mask = ipv4Mask(prefix);
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Normalizes and converts an IPv6 address string (including "::" shorthands)
 * into a 128-bit BigInt. Each segment must be 1-4 hex digits, and "::" must
 * stand for at least one 16-bit group of zeros.
 */
function ipv6ToBigInt(ip: string): bigint {
  let canonicalIp = ip.trim().toLowerCase();

  // Handle the double-colon "::" shorthand by expanding it with zeros.
  if (canonicalIp.includes('::')) {
    const parts = canonicalIp.split('::');
    if (parts.length > 2) {
      throw new Error(`Invalid IPv6 address: multiple "::" groups found in ${ip}`);
    }

    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];

    const missingCount = 8 - (left.length + right.length);
    // "::" is only valid when it represents one or more groups of zeros.
    if (missingCount < 1) {
      throw new Error(`Invalid IPv6 address: "::" must represent at least one zero group in ${ip}`);
    }

    const middle = Array(missingCount).fill('0');
    canonicalIp = [...left, ...middle, ...right].join(':');
  }

  const segments = canonicalIp.split(':');
  if (segments.length !== 8) {
    throw new Error(`Invalid IPv6 address: must contain 8 segments after expansion in ${ip}`);
  }

  // Convert the 8 hex segments into a single 128-bit BigInt.
  let result = 0n;
  for (const segment of segments) {
    // Strict check: exactly 1-4 hex digits. This rejects partially-valid
    // segments like "1ggg" or "12x" that parseInt would silently truncate.
    if (!/^[0-9a-f]{1,4}$/.test(segment)) {
      throw new Error(`Invalid IPv6 segment "${segment}" in ${ip}`);
    }
    // Shift left by 16 bits and add the current segment value.
    result = (result << 16n) + BigInt(parseInt(segment, 16));
  }

  return result;
}

/**
 * Checks if an IPv6 address is within a given IPv6 CIDR range.
 * @param ip - The IPv6 address (e.g., "2001:db8::1")
 * @param cidr - The CIDR range (e.g., "2001:db8::/32")
 */
function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = splitCidr(cidr);
  const prefix = parsePrefix(prefixStr, 128);

  const ipInt = ipv6ToBigInt(ip);
  const rangeInt = ipv6ToBigInt(rangeIp);

  // If the prefix is 0, the CIDR matches everything.
  if (prefix === 0) return true;

  const mask = ipv6Mask(prefix);
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Checks whether two IPv4 CIDR ranges overlap (intersect).
 *
 * Because CIDR blocks are power-of-two-sized and self-aligned, two of them can
 * only ever nest or be disjoint — never partially overlap. So they intersect
 * iff, when both network addresses are masked down to the SHORTER (broader)
 * prefix, the network bits are equal.
 *
 * @param cidrA - e.g. "192.168.1.0/24"
 * @param cidrB - e.g. "192.168.0.0/16"
 */
function cidrsOverlap(cidrA: string, cidrB: string): boolean {
  const [ipA, prefixStrA] = splitCidr(cidrA);
  const [ipB, prefixStrB] = splitCidr(cidrB);
  const prefixA = parsePrefix(prefixStrA, 32);
  const prefixB = parsePrefix(prefixStrB, 32);

  const netA = ipToInt(ipA);
  const netB = ipToInt(ipB);

  const minPrefix = Math.min(prefixA, prefixB);
  // A /0 on either side spans the whole space, so any block overlaps it.
  if (minPrefix === 0) return true;

  const mask = ipv4Mask(minPrefix);
  return (netA & mask) === (netB & mask);
}

/**
 * Checks whether two IPv6 CIDR ranges overlap (intersect).
 * Same reasoning as the IPv4 version, using 128-bit BigInt math.
 *
 * @param cidrA - e.g. "2001:db8::/32"
 * @param cidrB - e.g. "2001:db8:abcd::/48"
 */
function cidrsOverlapV6(cidrA: string, cidrB: string): boolean {
  const [ipA, prefixStrA] = splitCidr(cidrA);
  const [ipB, prefixStrB] = splitCidr(cidrB);
  const prefixA = parsePrefix(prefixStrA, 128);
  const prefixB = parsePrefix(prefixStrB, 128);

  const netA = ipv6ToBigInt(ipA);
  const netB = ipv6ToBigInt(ipB);

  const minPrefix = Math.min(prefixA, prefixB);
  if (minPrefix === 0) return true;

  const mask = ipv6Mask(minPrefix);
  return (netA & mask) === (netB & mask);
}

export {
  ipToInt,
  isIpInCidr,
  ipv6ToBigInt,
  isIpv6InCidr,
  cidrsOverlap,
  cidrsOverlapV6,
};

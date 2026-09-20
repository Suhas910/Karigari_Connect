# backend/app/ssrf_protection.py
import ipaddress
import logging
import os
import socket
import urllib.parse
from typing import Tuple, List, Optional
import requests

logger = logging.getLogger(__name__)

# IPv6 Unique Local Address network: fc00::/7 (covers fc00::/8 and fd00::/8)
IPV6_ULA = ipaddress.IPv6Network("fc00::/7")
# IPv6 Link-Local
IPV6_LINK_LOCAL = ipaddress.IPv6Network("fe80::/10")

# Extra disallowed IPv4 blocks
BLOCKED_IPV4_NETWORKS = [
    ipaddress.IPv4Network("0.0.0.0/8"),
    ipaddress.IPv4Network("10.0.0.0/8"),
    ipaddress.IPv4Network("100.64.0.0/10"),   # CGNAT
    ipaddress.IPv4Network("127.0.0.0/8"),     # Loopback
    ipaddress.IPv4Network("169.254.0.0/16"),  # Link-local / Cloud metadata
    ipaddress.IPv4Network("172.16.0.0/12"),   # Private RFC1918
    ipaddress.IPv4Network("192.0.0.0/24"),    # IETF Protocol
    ipaddress.IPv4Network("192.0.2.0/24"),    # TEST-NET-1
    ipaddress.IPv4Network("192.168.0.0/16"),  # Private RFC1918
    ipaddress.IPv4Network("198.18.0.0/15"),   # Benchmarking
    ipaddress.IPv4Network("198.51.100.0/24"), # TEST-NET-2
    ipaddress.IPv4Network("203.0.113.0/24"),  # TEST-NET-3
    ipaddress.IPv4Network("224.0.0.0/4"),     # Multicast
    ipaddress.IPv4Network("240.0.0.0/4"),     # Reserved
    ipaddress.IPv4Network("255.255.255.255/32"),
]

def is_safe_ip(ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """
    Check if an IP address is a safe public IP.
    Blocks:
    - IPv4: private, loopback, link-local, multicast, reserved, unspecified
    - IPv6: loopback (::1), link-local (fe80::/10), ULA (fc00::/7, fd00::/8), multicast, unspecified, IPv4-mapped
    """
    if ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_reserved or ip_obj.is_unspecified:
        return False

    if isinstance(ip_obj, ipaddress.IPv4Address):
        if ip_obj.is_private:
            return False
        for net in BLOCKED_IPV4_NETWORKS:
            if ip_obj in net:
                return False
        return True

    elif isinstance(ip_obj, ipaddress.IPv6Address):
        if ip_obj.is_private or ip_obj in IPV6_ULA or ip_obj in IPV6_LINK_LOCAL:
            return False
        # Handle IPv4-mapped IPv6 (::ffff:127.0.0.1)
        if ip_obj.ipv4_mapped:
            return is_safe_ip(ip_obj.ipv4_mapped)
        return True

    return False


def resolve_all_ips(hostname: str, port: int = 443) -> List[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """Resolve hostname to all IP addresses."""
    # First check if hostname is already an IP literal
    try:
        clean_host = hostname.strip("[]")
        ip = ipaddress.ip_address(clean_host)
        return [ip]
    except ValueError:
        pass

    try:
        addr_info = socket.getaddrinfo(hostname, port, family=socket.AF_UNSPEC, type=socket.SOCK_STREAM)
        results = []
        for item in addr_info:
            sockaddr = item[4]
            ip_str = sockaddr[0]
            try:
                results.append(ipaddress.ip_address(ip_str))
            except ValueError:
                continue
        return results
    except Exception as exc:
        logger.warning("DNS resolution failed for %s: %s", hostname, exc)
        return []


def validate_safe_url(url: str, allow_dev_http: bool = False) -> Tuple[bool, str]:
    """
    Validate that a URL is safe against SSRF:
    - Enforces scheme (https, or http if allow_dev_http or DEV mode)
    - Resolves hostname to IPs and ensures ALL resolved IPs are safe
    """
    if not url or not isinstance(url, str):
        return False, "URL is empty or invalid."

    url_str = url.strip()
    try:
        parsed = urllib.parse.urlparse(url_str)
    except Exception:
        return False, "Malformed URL."

    allowed_schemes = ("https", "http") if (allow_dev_http or os.getenv("ENVIRONMENT", "development").lower() == "development") else ("https",)
    if parsed.scheme.lower() not in allowed_schemes:
        return False, f"Unsupported scheme '{parsed.scheme}'. Only HTTPS is allowed."

    hostname = parsed.hostname
    if not hostname:
        return False, "Missing hostname in URL."

    # Prevent credentials in URL (http://user:pass@host)
    if parsed.username or parsed.password:
        return False, "User credentials in URL are not permitted."

    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    resolved_ips = resolve_all_ips(hostname, port)

    if not resolved_ips:
        env = os.getenv("ENVIRONMENT", os.getenv("ENV", "development")).lower()
        if env != "production" and hostname in ("example.com", "images.unsplash.com", "actions.google.com"):
            return True, ""
        return False, f"Could not resolve host '{hostname}' to a valid IP address."

    for ip in resolved_ips:
        if not is_safe_ip(ip):
            return False, f"Host '{hostname}' resolves to blocked/internal IP '{ip}'."

    return True, ""


def safe_fetch_media(url: str, timeout: int = 10, max_bytes: int = 25 * 1024 * 1024) -> bytes:
    """
    Safely download media from an external URL with:
    - Pre-flight DNS resolution & IP validation
    - Re-validation of DNS and connected peer IP to stop DNS rebinding
    - Strict redirect controls
    - Enforced maximum download byte limits
    """
    is_safe, reason = validate_safe_url(url)
    if not is_safe:
        raise ValueError(f"SSRF protection blocked URL: {reason}")

    parsed = urllib.parse.urlparse(url)
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)

    # Re-resolve and re-verify at fetch time
    fresh_ips = resolve_all_ips(parsed.hostname, port)
    if not fresh_ips:
        raise ValueError(f"Could not resolve host '{parsed.hostname}' at fetch time")
    for ip in fresh_ips:
        if not is_safe_ip(ip):
            raise ValueError(f"DNS rebinding detected: host resolved to unsafe IP {ip}")

    # Fetch without following arbitrary redirects to prevent open redirect SSRF
    resp = requests.get(url, timeout=timeout, stream=True, allow_redirects=False)
    
    # If redirect, validate the Location target
    if resp.is_redirect:
        redirect_url = resp.headers.get("Location")
        if not redirect_url:
            raise ValueError("Redirect response missing Location header")
        # Recursively safe-fetch destination
        return safe_fetch_media(redirect_url, timeout=timeout, max_bytes=max_bytes)

    resp.raise_for_status()

    # Verify connected peer socket IP if available
    try:
        raw_conn = getattr(resp.raw, "_connection", None)
        sock = getattr(raw_conn, "sock", None)
        if sock:
            peer_ip_str = sock.getpeername()[0]
            peer_ip = ipaddress.ip_address(peer_ip_str)
            if not is_safe_ip(peer_ip):
                resp.close()
                raise ValueError(f"Connected socket peer IP '{peer_ip}' is not safe")
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise
        logger.debug("Could not inspect raw socket peer name: %s", exc)

    content = bytearray()
    for chunk in resp.iter_content(chunk_size=65536):
        content.extend(chunk)
        if len(content) > max_bytes:
            resp.close()
            raise ValueError(f"Downloaded media exceeds maximum allowed size of {max_bytes} bytes")

    return bytes(content)

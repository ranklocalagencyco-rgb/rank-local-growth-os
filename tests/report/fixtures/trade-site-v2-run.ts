import type { AuditReportData } from "@/report/model";

// Sanitized copy of a real audit run (audit-crawler/v4, audit-rules/v4, audit-score/v2, 2026-09-19), reduced to the columns the report
// reads. Business name, domain, phone numbers, email, street address and postcode are replaced with fictitious values; row ids are
// placeholders. Every measured value is untouched: scores, rule results, coverage, page roles, findings, PageSpeed metrics.
// Expected: overall 83.88 (complete), Technical 24.93, Local SEO 16, Content 20, Performance 12.95, Crawl 10, coverage 96%.
// Not a test file (no .test suffix).

export const tradeSiteV2Run = {
  "run": {
    "id": "7e8fe0d6-0000-4000-8000-000000000001",
    "workspace_id": "11111111-1111-4111-8111-111111111111",
    "prospect_id": "33333333-3333-4333-8333-333333333333",
    "job_id": null,
    "requested_by": null,
    "status": "completed",
    "website_url": "https://example-roofing.co.uk",
    "canonical_domain": "example-roofing.co.uk",
    "crawler_version": "audit-crawler/v4",
    "rules_version": "audit-rules/v4",
    "started_at": "2026-09-19T19:33:19.348+00:00",
    "completed_at": "2026-09-19T19:33:38.936+00:00",
    "failed_at": null,
    "pages_attempted": 15,
    "pages_succeeded": 15,
    "pages_failed": 0,
    "error_summary": null,
    "site_summary_json": {
      "nap": {
        "emails": [
          {
            "pages": 15,
            "value": "office@example-roofing.co.uk",
            "sources": [
              "mailto_link",
              "text:footer",
              "text:main"
            ]
          }
        ],
        "phones": [
          {
            "raw": "07700 900111",
            "pages": 15,
            "digits": "07700900111",
            "sources": [
              "tel_link",
              "text:header",
              "text:footer",
              "text:main"
            ]
          },
          {
            "raw": "01632 960111",
            "pages": 15,
            "digits": "01632960111",
            "sources": [
              "tel_link",
              "text:header",
              "text:footer"
            ]
          },
          {
            "raw": "07700 900222",
            "pages": 15,
            "digits": "07700900222",
            "sources": [
              "tel_link",
              "text:footer"
            ]
          }
        ],
        "postcodes": [
          {
            "pages": 15,
            "value": "UB9 9ZZ",
            "sources": [
              "text:footer",
              "text:main"
            ]
          }
        ],
        "localities": [
          {
            "value": "Uxbridge",
            "sources": [
              "h1_in_pattern",
              "role:location"
            ]
          },
          {
            "value": "Hillingdon",
            "sources": [
              "h1_in_pattern"
            ]
          },
          {
            "value": "Ruislip",
            "sources": [
              "role:location",
              "h1_in_pattern"
            ]
          },
          {
            "value": "Gerrards Cross",
            "sources": [
              "role:location",
              "h1_in_pattern"
            ]
          },
          {
            "value": "Buckinghamshire",
            "sources": [
              "role:location",
              "h1_in_pattern"
            ]
          }
        ],
        "businessNames": [
          {
            "value": "Example Roofing",
            "sources": [
              "og_site_name",
              "schema_organization"
            ]
          }
        ],
        "pagesEvaluated": 15,
        "pagesWithEmail": 15,
        "pagesWithPhone": 15,
        "addressCandidates": [
          {
            "text": "1 Example Yard, Sample Lane, Denham, Buckinghamshire, UB9 9ZZ",
            "pages": 15,
            "sources": [
              "text:footer"
            ],
            "postcode": "UB9 9ZZ"
          },
          {
            "text": "You can find us at Example Roofing, 1 Example Yard, Sample Lane, Denham, Buckinghamshire, UB9 9ZZ.",
            "pages": 1,
            "sources": [
              "text:main"
            ],
            "postcode": "UB9 9ZZ"
          }
        ],
        "pagesWithAddressCandidate": 15
      },
      "schema": {
        "hasGeo": false,
        "sameAs": [],
        "hasName": false,
        "areaServed": [],
        "hasAddress": false,
        "reviewCount": 0,
        "hasTelephone": false,
        "addressLocality": null,
        "organizationPages": 15,
        "hasAggregateRating": false,
        "localBusinessPages": 0,
        "localBusinessTypes": [],
        "localBusinessMissingFields": []
      },
      "crawlScope": {
        "pageCap": 15,
        "frontierRemaining": 0
      },
      "homepageUrl": "https://example-roofing.co.uk",
      "pagesFailed": 0,
      "pagesCrawled": 15,
      "servicePages": [
        {
          "path": "/new-roofs",
          "service": "New Roofs"
        },
        {
          "path": "/guttering",
          "service": "Guttering Services"
        },
        {
          "path": "/roof-repairs",
          "service": "Roof Repairs"
        },
        {
          "path": "/liquid-rubber-roofing",
          "service": "Liquid Rubber Roofing"
        },
        {
          "path": "/fibreglass-flat-roofs",
          "service": "Fibreglass Flat Roofs"
        },
        {
          "path": "/three-layer-flat-roofs",
          "service": "Three Layer Flat Roofs"
        }
      ],
      "homepageHttps": true,
      "locationPages": [
        {
          "hub": false,
          "path": "/ruislip",
          "locality": "Ruislip"
        },
        {
          "hub": false,
          "path": "/uxbridge",
          "locality": "Uxbridge"
        },
        {
          "hub": true,
          "path": "/areas-we-cover",
          "locality": null
        },
        {
          "hub": false,
          "path": "/gerrards-cross",
          "locality": "Gerrards Cross"
        },
        {
          "hub": false,
          "path": "/buckinghamshire",
          "locality": "Buckinghamshire"
        }
      ],
      "aboutPageFound": false,
      "blogPagesFound": 0,
      "homepageStatus": 200,
      "evidenceVersion": 3,
      "schemaTypesSeen": [
        "BreadcrumbList",
        "CreativeWork",
        "EntryPoint",
        "ImageObject",
        "ListItem",
        "Organization",
        "PropertyValueSpecification",
        "ReadAction",
        "SearchAction",
        "WebPage",
        "WebSite"
      ],
      "contactPageFound": true,
      "homepageFinalUrl": "https://example-roofing.co.uk/",
      "sitemapReachable": true,
      "galleryPagesFound": 1,
      "homepageLinkCount": 15,
      "internalRedirects": [],
      "robotsDisallowAll": false,
      "servicePagesFound": 6,
      "locationPagesFound": 5,
      "robotsTxtReachable": true,
      "brokenInternalLinks": 0,
      "clientRenderedPages": 0,
      "duplicateMetaGroups": [],
      "sitemapUrlsSameSite": 15,
      "duplicateTitleGroups": [],
      "homepageRedirectChain": [],
      "homepageRenderingMode": "server_rendered",
      "serviceLocationCombos": [
        {
          "path": "/new-roofs",
          "service": "New Roofs",
          "locality": "Uxbridge"
        },
        {
          "path": "/new-roofs",
          "service": "New Roofs",
          "locality": "Hillingdon"
        },
        {
          "path": "/guttering",
          "service": "Guttering Services",
          "locality": "Uxbridge"
        },
        {
          "path": "/guttering",
          "service": "Guttering Services",
          "locality": "Hillingdon"
        },
        {
          "path": "/roof-repairs",
          "service": "Roof Repairs",
          "locality": "Uxbridge"
        },
        {
          "path": "/roof-repairs",
          "service": "Roof Repairs",
          "locality": "Hillingdon"
        },
        {
          "path": "/liquid-rubber-roofing",
          "service": "Liquid Rubber Roofing",
          "locality": "Uxbridge"
        },
        {
          "path": "/liquid-rubber-roofing",
          "service": "Liquid Rubber Roofing",
          "locality": "Hillingdon"
        },
        {
          "path": "/fibreglass-flat-roofs",
          "service": "Fibreglass Flat Roofs",
          "locality": "Uxbridge"
        },
        {
          "path": "/fibreglass-flat-roofs",
          "service": "Fibreglass Flat Roofs",
          "locality": "Hillingdon"
        },
        {
          "path": "/three-layer-flat-roofs",
          "service": "Three Layer Flat Roofs",
          "locality": "Uxbridge"
        },
        {
          "path": "/three-layer-flat-roofs",
          "service": "Three Layer Flat Roofs",
          "locality": "Hillingdon"
        }
      ],
      "sitemapUrlsDiscovered": 15,
      "testimonialsPageFound": true,
      "duplicateTitleMetaPairs": [],
      "linksTruncatedOnAnyPage": false,
      "pagesWithoutInboundLinks": [],
      "renderedContentEvaluated": true,
      "pagesWithLocalBusinessSchema": 0
    },
    "crawl_state_json": {},
    "retention_class": "audit_evidence",
    "created_at": "2026-09-19T19:33:14.152779+00:00",
    "updated_at": "2026-09-19T19:33:39.088128+00:00",
    "blocked_at": null
  },
  "prospect": {
    "id": "33333333-3333-4333-8333-333333333333",
    "display_name": "Example Roofing",
    "canonical_domain": "example-roofing.co.uk",
    "website_url": "https://example-roofing.co.uk"
  },
  "pages": [
    {
      "path": "/",
      "requested_url": "https://example-roofing.co.uk/",
      "page_role": "homepage",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-1",
      "evidence_json": {}
    },
    {
      "path": "/new-roofs",
      "requested_url": "https://example-roofing.co.uk/new-roofs/",
      "page_role": "service",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-2",
      "evidence_json": {}
    },
    {
      "path": "/guttering",
      "requested_url": "https://example-roofing.co.uk/guttering/",
      "page_role": "service",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-3",
      "evidence_json": {}
    },
    {
      "path": "/roof-repairs",
      "requested_url": "https://example-roofing.co.uk/roof-repairs/",
      "page_role": "service",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-4",
      "evidence_json": {}
    },
    {
      "path": "/liquid-rubber-roofing",
      "requested_url": "https://example-roofing.co.uk/liquid-rubber-roofing/",
      "page_role": "service",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-5",
      "evidence_json": {}
    },
    {
      "path": "/fibreglass-flat-roofs",
      "requested_url": "https://example-roofing.co.uk/fibreglass-flat-roofs/",
      "page_role": "service",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-6",
      "evidence_json": {}
    },
    {
      "path": "/three-layer-flat-roofs",
      "requested_url": "https://example-roofing.co.uk/three-layer-flat-roofs/",
      "page_role": "service",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-7",
      "evidence_json": {}
    },
    {
      "path": "/ruislip",
      "requested_url": "https://example-roofing.co.uk/ruislip/",
      "page_role": "location",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-8",
      "evidence_json": {}
    },
    {
      "path": "/uxbridge",
      "requested_url": "https://example-roofing.co.uk/uxbridge/",
      "page_role": "location",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-9",
      "evidence_json": {}
    },
    {
      "path": "/areas-we-cover",
      "requested_url": "https://example-roofing.co.uk/areas-we-cover/",
      "page_role": "location",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-10",
      "evidence_json": {}
    },
    {
      "path": "/gerrards-cross",
      "requested_url": "https://example-roofing.co.uk/gerrards-cross/",
      "page_role": "location",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-11",
      "evidence_json": {}
    },
    {
      "path": "/buckinghamshire",
      "requested_url": "https://example-roofing.co.uk/buckinghamshire/",
      "page_role": "location",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-12",
      "evidence_json": {}
    },
    {
      "path": "/contact-us",
      "requested_url": "https://example-roofing.co.uk/contact-us/",
      "page_role": "contact",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-13",
      "evidence_json": {}
    },
    {
      "path": "/reviews",
      "requested_url": "https://example-roofing.co.uk/reviews/",
      "page_role": "testimonials",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-14",
      "evidence_json": {}
    },
    {
      "path": "/gallery",
      "requested_url": "https://example-roofing.co.uk/gallery/",
      "page_role": "gallery",
      "fetch_ok": true,
      "http_status": 200,
      "content_type": "text/html; charset=UTF-8",
      "id": "page-15",
      "evidence_json": {}
    }
  ],
  "findings": [
    {
      "id": "finding-1",
      "workspace_id": "11111111-1111-4111-8111-111111111111",
      "audit_run_id": "7e8fe0d6-0000-4000-8000-000000000001",
      "prospect_id": "33333333-3333-4333-8333-333333333333",
      "page_id": "page-7",
      "scope": "page",
      "code": "meta_description_too_long",
      "severity": "info",
      "evidence_json": {
        "url": "https://example-roofing.co.uk/three-layer-flat-roofs/",
        "path": "/three-layer-flat-roofs",
        "pageRole": "service",
        "threshold": 160,
        "httpStatus": 200,
        "metaDescription": "For the best in three layer flat roof solutions across the Uxbridge and Hillingdon area, contact Example Roofing. Give our experienced roofers a call on 07700 900333",
        "metaDescriptionLength": 161
      },
      "rule_version": "audit-rules/v4",
      "created_at": "2026-09-19T19:33:38.873204+00:00"
    },
    {
      "id": "finding-2",
      "workspace_id": "11111111-1111-4111-8111-111111111111",
      "audit_run_id": "7e8fe0d6-0000-4000-8000-000000000001",
      "prospect_id": "33333333-3333-4333-8333-333333333333",
      "page_id": null,
      "scope": "site",
      "code": "no_localbusiness_schema",
      "severity": "medium",
      "evidence_json": {
        "homepageUrl": "https://example-roofing.co.uk",
        "pagesCrawled": 15,
        "schemaTypesSeen": [
          "BreadcrumbList",
          "CreativeWork",
          "EntryPoint",
          "ImageObject",
          "ListItem",
          "Organization",
          "PropertyValueSpecification",
          "ReadAction",
          "SearchAction",
          "WebPage",
          "WebSite"
        ]
      },
      "rule_version": "audit-rules/v4",
      "created_at": "2026-09-19T19:33:38.873204+00:00"
    }
  ],
  "observations": [
    {
      "id": "obs-desktop",
      "workspace_id": "11111111-1111-4111-8111-111111111111",
      "prospect_id": "33333333-3333-4333-8333-333333333333",
      "audit_run_id": "7e8fe0d6-0000-4000-8000-000000000001",
      "provider": "pagespeed",
      "provider_version": "13.4.1",
      "strategy": "desktop",
      "page_role": "homepage",
      "requested_url": "https://example-roofing.co.uk/",
      "final_url": "https://example-roofing.co.uk/",
      "status": "succeeded",
      "attempts": 1,
      "error_code": null,
      "error_summary": null,
      "performance_score": 80,
      "accessibility_score": 85,
      "best_practices_score": 96,
      "seo_score": 100,
      "fcp_ms": 624,
      "lcp_ms": 2216,
      "cls": 0.003,
      "tbt_ms": 61,
      "speed_index_ms": 3390,
      "tti_ms": 2239,
      "field_data_available": false,
      "field_scope": null,
      "field_lcp_ms": null,
      "field_inp_ms": null,
      "field_cls": null,
      "field_overall_category": null,
      "run_warnings": [],
      "observed_at": "2026-09-19T19:34:10.889+00:00",
      "retention_class": "audit_evidence",
      "created_at": "2026-09-19T19:33:41.072899+00:00",
      "updated_at": "2026-09-19T19:34:34.276524+00:00"
    },
    {
      "id": "obs-mobile",
      "workspace_id": "11111111-1111-4111-8111-111111111111",
      "prospect_id": "33333333-3333-4333-8333-333333333333",
      "audit_run_id": "7e8fe0d6-0000-4000-8000-000000000001",
      "provider": "pagespeed",
      "provider_version": "13.4.1",
      "strategy": "mobile",
      "page_role": "homepage",
      "requested_url": "https://example-roofing.co.uk/",
      "final_url": "https://example-roofing.co.uk/",
      "status": "succeeded",
      "attempts": 1,
      "error_code": null,
      "error_summary": null,
      "performance_score": 66,
      "accessibility_score": 85,
      "best_practices_score": 96,
      "seo_score": 100,
      "fcp_ms": 2724,
      "lcp_ms": 10404,
      "cls": 0.002,
      "tbt_ms": 99,
      "speed_index_ms": 5671,
      "tti_ms": 10538,
      "field_data_available": false,
      "field_scope": null,
      "field_lcp_ms": null,
      "field_inp_ms": null,
      "field_cls": null,
      "field_overall_category": null,
      "run_warnings": [],
      "observed_at": "2026-09-19T19:33:44.025+00:00",
      "retention_class": "audit_evidence",
      "created_at": "2026-09-19T19:33:41.072899+00:00",
      "updated_at": "2026-09-19T19:34:01.090513+00:00"
    }
  ],
  "score": {
    "id": "score-1",
    "workspace_id": "11111111-1111-4111-8111-111111111111",
    "prospect_id": "33333333-3333-4333-8333-333333333333",
    "audit_run_id": "7e8fe0d6-0000-4000-8000-000000000001",
    "scoring_version": "audit-score/v2",
    "score_status": "complete",
    "overall_score": 83.88,
    "technical_score": 24.93,
    "local_seo_score": 16,
    "content_structure_score": 20,
    "performance_score": 12.95,
    "crawl_score": 10,
    "evaluated_weight": 100,
    "evidence_coverage": 96,
    "breakdown_json": {
      "inputs": {
        "crawlCapped": false,
        "pagesStored": 15,
        "crawlBlocked": false,
        "rulesVersion": "audit-rules/v4",
        "crawlerVersion": "audit-crawler/v4",
        "observationIds": [
          "obs-desktop",
          "obs-mobile"
        ],
        "evidenceVersion": 3,
        "htmlPagesScored": 15,
        "crawlCapInferred": false,
        "challengePagesExcluded": 0,
        "renderedContentEvaluated": true
      },
      "constants": {
        "categoryMinCoverage": 0.5,
        "completeMinCoverage": 0.7,
        "provisionalMinCoverage": 0.4
      },
      "categories": {
        "crawl": {
          "rules": {
            "pages_indexable": {
              "max": 1,
              "points": 1,
              "status": "pass",
              "evidence": {
                "passing": 14,
                "eligible": 14
              }
            },
            "homepage_indexable": {
              "max": 4,
              "points": 4,
              "status": "pass",
              "evidence": {
                "noindex": false,
                "metaRobots": "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
              }
            },
            "homepage_reachable": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "homepageStatus": 200
              }
            },
            "pages_fetch_success": {
              "max": 1,
              "points": 1,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15
              }
            },
            "robots_allows_crawling": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "robotsDisallowAll": false,
                "robotsTxtReachable": true
              }
            }
          },
          "score": 10,
          "earned": 10,
          "weight": 10,
          "coverage": 1,
          "nominalMax": 10,
          "suppressed": null,
          "evaluatedMax": 10
        },
        "local_seo": {
          "rules": {
            "nap_phone": {
              "max": 4,
              "points": 4,
              "status": "pass",
              "evidence": {
                "phonesFound": 3,
                "pagesEvaluated": 15,
                "pagesWithPhone": 15,
                "schemaTelephone": false
              }
            },
            "nap_address": {
              "max": 4,
              "points": 4,
              "status": "pass",
              "evidence": {
                "schemaAddress": false,
                "pagesEvaluated": 15,
                "postcodesFound": 1,
                "addressCandidates": 2
              }
            },
            "location_pages": {
              "max": 5,
              "points": 5,
              "status": "pass",
              "evidence": {
                "locationPages": 4,
                "locationIndexPages": 1
              }
            },
            "localbusiness_name": {
              "max": 1,
              "points": 0,
              "status": "fail",
              "evidence": {
                "hasName": false,
                "localBusinessPages": 0
              }
            },
            "localbusiness_schema": {
              "max": 5,
              "points": 0,
              "status": "fail",
              "evidence": {
                "localBusinessTypes": [],
                "pagesWithLocalBusinessSchema": 0
              }
            },
            "localbusiness_address": {
              "max": 2,
              "points": 0,
              "status": "fail",
              "evidence": {
                "hasAddress": false,
                "localBusinessPages": 0
              }
            },
            "service_area_evidence": {
              "max": 3,
              "points": 3,
              "status": "pass",
              "evidence": {
                "locationPages": 4,
                "schemaAreaServed": 0,
                "localitiesObserved": 5,
                "serviceLocationCombos": 12
              }
            },
            "localbusiness_telephone": {
              "max": 1,
              "points": 0,
              "status": "fail",
              "evidence": {
                "hasTelephone": false,
                "localBusinessPages": 0
              }
            }
          },
          "score": 16,
          "earned": 16,
          "weight": 25,
          "coverage": 1,
          "nominalMax": 25,
          "suppressed": null,
          "evaluatedMax": 25
        },
        "technical": {
          "rules": {
            "https": {
              "max": 4,
              "points": 4,
              "status": "pass",
              "evidence": {
                "homepageFinalUrl": "https://example-roofing.co.uk/"
              }
            },
            "sitemap": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "sitemapReachable": true,
                "sitemapUrlsSameSite": 15
              }
            },
            "robots_txt": {
              "max": 1,
              "points": 1,
              "status": "pass",
              "evidence": {
                "robotsTxtReachable": true
              }
            },
            "h1_coverage": {
              "max": 3,
              "points": 3,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15
              }
            },
            "title_length": {
              "max": 1,
              "points": 1,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15,
                "maxChars": 70,
                "minChars": 20
              }
            },
            "title_coverage": {
              "max": 4,
              "points": 4,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15
              }
            },
            "structured_data": {
              "max": 1,
              "points": 1,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15
              }
            },
            "viewport_coverage": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15
              }
            },
            "canonical_coverage": {
              "max": 3,
              "points": 3,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15
              }
            },
            "meta_description_length": {
              "max": 1,
              "points": 0.93,
              "status": "partial",
              "evidence": {
                "passing": 14,
                "eligible": 15,
                "maxChars": 160,
                "minChars": 50
              }
            },
            "meta_description_coverage": {
              "max": 3,
              "points": 3,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15
              }
            }
          },
          "score": 24.93,
          "earned": 24.93,
          "weight": 25,
          "coverage": 1,
          "nominalMax": 25,
          "suppressed": null,
          "evaluatedMax": 25
        },
        "performance": {
          "rules": {
            "field_cls": {
              "max": 1,
              "points": 0,
              "status": "not_evaluated",
              "evidence": {
                "reason": "field_data_unavailable",
                "observationId": "obs-mobile"
              }
            },
            "field_inp": {
              "max": 1,
              "points": 0,
              "status": "not_evaluated",
              "evidence": {
                "reason": "field_data_unavailable",
                "observationId": "obs-mobile"
              }
            },
            "field_lcp": {
              "max": 2,
              "points": 0,
              "status": "not_evaluated",
              "evidence": {
                "reason": "field_data_unavailable",
                "observationId": "obs-mobile"
              }
            },
            "cls_mobile_lab": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "cls": 0.002,
                "thresholds": [
                  0.1,
                  0.25
                ],
                "observationId": "obs-mobile"
              }
            },
            "lcp_mobile_lab": {
              "max": 3,
              "points": 0,
              "status": "fail",
              "evidence": {
                "lcpMs": 10404,
                "thresholds": [
                  2500,
                  4000
                ],
                "observationId": "obs-mobile"
              }
            },
            "tbt_mobile_lab": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "tbtMs": 99,
                "thresholds": [
                  200,
                  600
                ],
                "observationId": "obs-mobile"
              }
            },
            "lighthouse_performance_mobile": {
              "max": 6,
              "points": 3.96,
              "status": "partial",
              "evidence": {
                "observationId": "obs-mobile",
                "performanceScore": 66
              }
            },
            "lighthouse_performance_desktop": {
              "max": 3,
              "points": 2.4,
              "status": "partial",
              "evidence": {
                "observationId": "obs-desktop",
                "performanceScore": 80
              }
            }
          },
          "score": 12.95,
          "earned": 10.36,
          "weight": 20,
          "coverage": 0.8,
          "nominalMax": 20,
          "suppressed": null,
          "evaluatedMax": 16
        },
        "content_structure": {
          "rules": {
            "contact_page": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "contactPages": 1
              }
            },
            "service_pages": {
              "max": 4,
              "points": 4,
              "status": "pass",
              "evidence": {
                "servicePages": 6
              }
            },
            "unique_titles": {
              "max": 3,
              "points": 3,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15,
                "duplicateGroups": 0
              }
            },
            "non_thin_pages": {
              "max": 3,
              "points": 3,
              "status": "pass",
              "evidence": {
                "passing": 13,
                "eligible": 13,
                "minWords": 150
              }
            },
            "no_internal_redirects": {
              "max": 1,
              "points": 1,
              "status": "pass",
              "evidence": {
                "linkedInternalRedirects": 0
              }
            },
            "homepage_links_key_pages": {
              "max": 3,
              "points": 3,
              "status": "pass",
              "evidence": {
                "passing": 10,
                "eligible": 10,
                "homepageLinkCount": 15
              }
            },
            "no_broken_internal_links": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "brokenInternalLinks": 0
              }
            },
            "unique_meta_descriptions": {
              "max": 2,
              "points": 2,
              "status": "pass",
              "evidence": {
                "passing": 15,
                "eligible": 15,
                "duplicateGroups": 0
              }
            }
          },
          "score": 20,
          "earned": 20,
          "weight": 20,
          "coverage": 1,
          "nominalMax": 20,
          "suppressed": null,
          "evaluatedMax": 20
        }
      },
      "scoringVersion": "audit-score/v2"
    },
    "calculated_at": "2026-09-19T19:34:43.617+00:00",
    "retention_class": "audit_evidence",
    "created_at": "2026-09-19T19:34:43.761697+00:00"
  }
} as unknown as AuditReportData;

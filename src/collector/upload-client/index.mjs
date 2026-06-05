export async function postCollectorJson({
  baseUrl,
  path,
  headers,
  fetchImpl,
  body,
}) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) {
    throw new Error(`collector_upload_failed:${path}:${response.status}`);
  }
  return json;
}

export async function uploadSourceRun({ config, fetchImpl, envelope }) {
  return postCollectorJson({
    baseUrl: config.collectorBaseUrl,
    path: "/api/collector/source-run",
    headers: config.headers,
    fetchImpl,
    body: envelope,
  });
}

export async function uploadArticleSnapshots({
  config,
  fetchImpl,
  articleEnvelopes,
}) {
  const uploadedArticleSnapshotIds = [];
  for (const articleEnvelope of articleEnvelopes) {
    const response = await postCollectorJson({
      baseUrl: config.collectorBaseUrl,
      path: "/api/collector/article-snapshot",
      headers: config.headers,
      fetchImpl,
      body: articleEnvelope,
    });
    uploadedArticleSnapshotIds.push(response.id);
  }
  return uploadedArticleSnapshotIds;
}

export async function uploadEvidenceAssets({ config, fetchImpl, evidenceAssets }) {
  let uploadedEvidenceAssetCount = 0;
  for (const evidence of evidenceAssets) {
    await postCollectorJson({
      baseUrl: config.collectorBaseUrl,
      path: "/api/collector/evidence-asset",
      headers: config.headers,
      fetchImpl,
      body: evidence,
    });
    uploadedEvidenceAssetCount += 1;
  }

  return uploadedEvidenceAssetCount > 0 ? { uploadedEvidenceAssetCount } : {};
}

export async function uploadExtractionResults({
  config,
  fetchImpl,
  extractionResults,
}) {
  let uploadedEvidenceAssetCount = 0;
  let uploadedEventDraftCount = 0;
  let uploadedCollectorFailureCount = 0;

  for (const result of extractionResults) {
    for (const evidence of result.evidenceAssets ?? []) {
      await postCollectorJson({
        baseUrl: config.collectorBaseUrl,
        path: "/api/collector/evidence-asset",
        headers: config.headers,
        fetchImpl,
        body: evidence,
      });
      uploadedEvidenceAssetCount += 1;
    }
    for (const draft of result.eventDrafts ?? []) {
      await postCollectorJson({
        baseUrl: config.collectorBaseUrl,
        path: "/api/collector/event-draft",
        headers: config.headers,
        fetchImpl,
        body: draft,
      });
      uploadedEventDraftCount += 1;
    }
    for (const failure of result.failures ?? []) {
      await postCollectorJson({
        baseUrl: config.collectorBaseUrl,
        path: "/api/collector/failure",
        headers: config.headers,
        fetchImpl,
        body: failure,
      });
      uploadedCollectorFailureCount += 1;
    }
  }

  if (!extractionResults.length) return {};

  return {
    uploadedEvidenceAssetCount,
    uploadedEventDraftCount,
    uploadedCollectorFailureCount,
  };
}

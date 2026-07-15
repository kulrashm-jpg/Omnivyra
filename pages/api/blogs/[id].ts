import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { getBlog, updateBlog, deleteBlog, type UpdateBlogInput } from '../../../backend/services/blogService';
import { createPublishingJob } from '../../../backend/services/publishingJobService';
import { getActiveIntegration, getIntegration } from '../../../backend/services/integrationService';
import { isCmsProvider } from '../../../backend/services/cms/registry';
import type { CmsProvider } from '../../../backend/services/cms/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const blog = await getBlog(id, companyId);
    if (!blog) return res.status(404).json({ error: 'Blog not found' });
    return res.status(200).json({ blog });
  }

  const roleGate = await enforceRole({
    req, res, companyId,
    allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const {
      title, content, content_markdown, content_blocks, slug, excerpt, featured_image_url, category, tags,
      seo_meta_title, seo_meta_description, is_featured, angle_type,
      status, content_type,
    } = req.body || {};
    const updates: UpdateBlogInput = {};
    if (title                !== undefined && typeof title    === 'string') updates.title               = title;
    if (content              !== undefined && typeof content  === 'string') updates.content             = content;
    if (content_markdown     !== undefined && typeof content_markdown === 'string') updates.content      = content_markdown;
    if (slug                 !== undefined) updates.slug                = typeof slug === 'string' ? slug : undefined;
    if (excerpt              !== undefined) updates.excerpt             = typeof excerpt === 'string' ? excerpt : null;
    if (featured_image_url   !== undefined) updates.featured_image_url  = typeof featured_image_url === 'string' ? featured_image_url : null;
    if (category             !== undefined) updates.category            = typeof category === 'string' ? category : null;
    if (tags                 !== undefined && Array.isArray(tags)) updates.tags = tags.map(String);
    if (seo_meta_title       !== undefined) updates.seo_meta_title       = typeof seo_meta_title === 'string' ? seo_meta_title : null;
    if (seo_meta_description !== undefined) updates.seo_meta_description = typeof seo_meta_description === 'string' ? seo_meta_description : null;
    if (is_featured          !== undefined) updates.is_featured          = is_featured === true;
    if (content_blocks       !== undefined && Array.isArray(content_blocks)) updates.content_blocks = content_blocks;
    if (angle_type           !== undefined) updates.angle_type           = typeof angle_type    === 'string' ? angle_type    : null;
    if (content_type         !== undefined) updates.content_type         = typeof content_type  === 'string' ? content_type  : null;
    if (status               !== undefined && ['draft', 'scheduled', 'published', 'failed', 'archived'].includes(status)) updates.status = status;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });
    try {
      const blog = await updateBlog(id, companyId, updates);
      // ?sync=remote: if the blog has an external_id, queue an update_post job
      // so the worker re-publishes the change via the existing adapter path.
      let syncQueued: { jobId: string | null; reason?: string } = { jobId: null };
      if (req.query.sync === 'remote' && blog.external_id) {
        const integration = blog.integration_id
          ? await getIntegration(blog.integration_id, companyId).catch(() => null)
          : (await getActiveIntegration(companyId, 'wordpress').catch(() => null))
            ?? (await getActiveIntegration(companyId, 'custom_blog_api').catch(() => null));
        if (!integration || !isCmsProvider(integration.type)) {
          syncQueued.reason = 'no CMS integration found for this blog';
        } else {
          const job = await createPublishingJob({
            companyId,
            websiteId: blog.website_id ?? integration.website_id ?? null,
            connectionId: integration.website_connection_id ?? null,
            blogId: blog.id,
            provider: integration.type as CmsProvider,
            jobType: 'update_post',
            idempotencyKey: `blog:${blog.id}:update:${integration.id}:${new Date().toISOString().slice(0, 16)}`,
            requestPayload: {
              external_id: blog.external_id,
              html_content: blog.content ?? '',
              title: blog.title,
              slug: blog.slug,
            },
            createdBy: roleGate.userId,
          });
          syncQueued = { jobId: job.id };
        }
      }
      return res.status(200).json({ blog, sync: syncQueued });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      // Optionally queue a remote delete BEFORE removing the local row, so the
      // worker can still read external_id + integration linkage.
      let syncQueued: { jobId: string | null; reason?: string } = { jobId: null };
      if (req.query.sync === 'remote') {
        const blog = await getBlog(id, companyId);
        if (blog?.external_id) {
          const integration = blog.integration_id
            ? await getIntegration(blog.integration_id, companyId).catch(() => null)
            : (await getActiveIntegration(companyId, 'wordpress').catch(() => null))
              ?? (await getActiveIntegration(companyId, 'custom_blog_api').catch(() => null));
          if (!integration || !isCmsProvider(integration.type)) {
            syncQueued.reason = 'no CMS integration found for this blog';
          } else if (integration.type === 'squarespace') {
            syncQueued.reason = 'remote delete not supported by Squarespace (no public write API)';
          } else {
            const job = await createPublishingJob({
              companyId,
              websiteId: blog.website_id ?? integration.website_id ?? null,
              connectionId: integration.website_connection_id ?? null,
              blogId: blog.id,
              provider: integration.type as CmsProvider,
              jobType: 'delete_post',
              idempotencyKey: `blog:${blog.id}:delete:${integration.id}`,
              requestPayload: { external_id: blog.external_id },
              createdBy: roleGate.userId,
            });
            syncQueued = { jobId: job.id };
          }
        } else {
          syncQueued.reason = 'blog has no external_id (never published remotely)';
        }
      }
      await deleteBlog(id, companyId);
      return res.status(200).json({ status: 'deleted', sync: syncQueued });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/blogs/:id' });

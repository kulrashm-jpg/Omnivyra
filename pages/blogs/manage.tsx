'use client';

import BlogManageView from '../../components/blog/BlogManageView';
import { useBlogManage } from '../../hooks/useBlogManage';

export default function BlogManagePage() {
  const d = useBlogManage();
  return <BlogManageView d={d} />;
}

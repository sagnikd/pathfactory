import { db } from '@/db'
import { assets } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { AssetUploadDialog } from '@/components/AssetUploadDialog'
import { AssetGrid } from './AssetGrid'
import { FileText } from 'lucide-react'
import { getDashboardAuthContext } from '@/lib/auth/impersonation'

export default async function AssetsPage() {
  const { dbUser } = await getDashboardAuthContext()

  const orgAssets = await db.select().from(assets)
    .where(eq(assets.organizationId, dbUser.organizationId))
    .orderBy(desc(assets.createdAt))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
          <p className="text-muted-foreground text-sm mt-1">Click any asset to edit its title, thumbnail, and tags</p>
        </div>
        <AssetUploadDialog organizationId={dbUser.organizationId} />
      </div>

      {orgAssets.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed gap-4">
          <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center">
            <FileText className="w-6 h-6 text-primary" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="font-semibold">No assets yet</h3>
            <p className="text-sm text-muted-foreground">Upload a PDF or paste a URL to get started</p>
          </div>
          <AssetUploadDialog organizationId={dbUser.organizationId} />
        </div>
      ) : (
        <AssetGrid assets={orgAssets} />
      )}
    </div>
  )
}

package com.haojunnong.deepseek;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Minimal read-only provider used to hand exported files to the system share sheet.
 * Avoids pulling in AndroidX just for FileProvider.
 */
public class ExportProvider extends ContentProvider {

    public static File exportDir(Context context) {
        File dir = new File(context.getCacheDir(), "exports");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    public static Uri uriFor(Context context, String name) {
        return new Uri.Builder()
                .scheme("content")
                .authority(context.getPackageName() + ".fileprovider")
                .appendPath(name)
                .build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("..") || name.contains("/")) {
            throw new FileNotFoundException("bad name");
        }
        File file = new File(exportDir(getContext()), name);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null) return "application/octet-stream";
        String lower = name.toLowerCase();
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".pdf")) return "application/pdf";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}

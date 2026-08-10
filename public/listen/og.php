<?php
declare(strict_types=1);
require __DIR__ . '/share-lib.php';

$video = share_video_id();
$rain = share_rain();
$theme = share_theme();
if ($video === '' || !extension_loaded('gd')) {
    header('Location: /social-card.jpg', true, 302);
    exit;
}

$track = youtube_metadata($video);
$root = dirname(__DIR__);
$backgroundPath = $root . '/backgrounds/desktop-banner-' . ($theme === 'day' ? 'light' : 'dark') . '.jpg';
$fontPath = $root . '/fonts/DMSans.ttf';
$background = @imagecreatefromjpeg($backgroundPath);
if (!$background) {
    header('Location: /social-card.jpg', true, 302);
    exit;
}

$canvas = imagecreatetruecolor(1200, 630);
$sourceWidth = imagesx($background);
$sourceHeight = imagesy($background);
$targetRatio = 1200 / 630;
$sourceRatio = $sourceWidth / $sourceHeight;
if ($sourceRatio > $targetRatio) {
    $cropHeight = $sourceHeight;
    $cropWidth = (int) round($cropHeight * $targetRatio);
    $sourceX = (int) round(($sourceWidth - $cropWidth) / 2);
    $sourceY = 0;
} else {
    $cropWidth = $sourceWidth;
    $cropHeight = (int) round($cropWidth / $targetRatio);
    $sourceX = 0;
    $sourceY = (int) round(($sourceHeight - $cropHeight) / 2);
}
imagecopyresampled($canvas, $background, 0, 0, $sourceX, $sourceY, 1200, 630, $cropWidth, $cropHeight);
imagedestroy($background);

imagealphablending($canvas, true);
$shade = imagecolorallocatealpha($canvas, 3, 13, 18, $theme === 'day' ? 54 : 35);
imagefilledrectangle($canvas, 0, 338, 1200, 630, $shade);
$lowerShade = imagecolorallocatealpha($canvas, 3, 13, 18, 24);
imagefilledrectangle($canvas, 0, 475, 1200, 630, $lowerShade);

$thumbnailBody = fetch_remote('https://i.ytimg.com/vi/' . rawurlencode($video) . '/hqdefault.jpg');
$thumbnail = is_string($thumbnailBody) ? @imagecreatefromstring($thumbnailBody) : false;
$discX = 105;
$discY = 366;
$discSize = 202;
$discCenterX = $discX + (int) ($discSize / 2);
$discCenterY = $discY + (int) ($discSize / 2);
$vinyl = imagecolorallocate($canvas, 7, 12, 14);
$vinylEdge = imagecolorallocate($canvas, 108, 137, 137);
imagefilledellipse($canvas, $discCenterX, $discCenterY, $discSize + 18, $discSize + 18, $vinyl);
imageellipse($canvas, $discCenterX, $discCenterY, $discSize + 12, $discSize + 12, $vinylEdge);

if ($thumbnail) {
    $square = imagecreatetruecolor($discSize, $discSize);
    $tw = imagesx($thumbnail);
    $th = imagesy($thumbnail);
    $crop = min($tw, $th);
    imagecopyresampled($square, $thumbnail, 0, 0, (int) (($tw - $crop) / 2), (int) (($th - $crop) / 2), $discSize, $discSize, $crop, $crop);
    $radius = $discSize / 2;
    for ($y = 0; $y < $discSize; $y++) {
        for ($x = 0; $x < $discSize; $x++) {
            $dx = $x - $radius + .5;
            $dy = $y - $radius + .5;
            if (($dx * $dx) + ($dy * $dy) <= $radius * $radius) {
                imagesetpixel($canvas, $discX + $x, $discY + $y, imagecolorat($square, $x, $y));
            }
        }
    }
    imagedestroy($square);
    imagedestroy($thumbnail);
}
$spindle = imagecolorallocate($canvas, 225, 235, 230);
imagefilledellipse($canvas, $discCenterX, $discCenterY, 9, 9, $spindle);
$highlight = imagecolorallocatealpha($canvas, 255, 255, 255, 72);
imagearc($canvas, $discCenterX, $discCenterY, $discSize - 12, $discSize - 12, 205, 310, $highlight);

$text = imagecolorallocate($canvas, 242, 243, 236);
$muted = imagecolorallocate($canvas, 171, 196, 194);
$accent = imagecolorallocate($canvas, 130, 208, 191);
$title = $track['title'];
if (function_exists('mb_strlen') && mb_strlen($title, 'UTF-8') > 46) $title = mb_substr($title, 0, 45, 'UTF-8') . '…';
elseif (strlen($title) > 54) $title = substr($title, 0, 53) . '…';

if (is_file($fontPath) && function_exists('imagettftext')) {
    imagettftext($canvas, 16, 0, 354, 392, $accent, $fontPath, strtoupper($rain) . ' · LISTEN IN THE RAIN');
    $fontSize = 38;
    while ($fontSize > 25) {
        $box = imagettfbbox($fontSize, 0, $fontPath, $title);
        if ($box && abs($box[2] - $box[0]) <= 760) break;
        $fontSize--;
    }
    imagettftext($canvas, $fontSize, 0, 350, 456, $text, $fontPath, $title);
    imagettftext($canvas, 22, 0, 352, 498, $muted, $fontPath, $track['artist']);
    imagettftext($canvas, 14, 0, 352, 558, $muted, $fontPath, 'barsaat.in');
} else {
    imagestring($canvas, 5, 352, 390, strtoupper($rain) . ' · LISTEN IN THE RAIN', $accent);
    imagestring($canvas, 5, 352, 435, $title, $text);
    imagestring($canvas, 4, 352, 472, $track['artist'], $muted);
    imagestring($canvas, 3, 352, 540, 'barsaat.in', $muted);
}

header('Content-Type: image/jpeg');
header('Cache-Control: public, max-age=86400, stale-while-revalidate=604800');
imagejpeg($canvas, null, 89);
imagedestroy($canvas);

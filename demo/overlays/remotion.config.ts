import { Config } from '@remotion/cli/config'

// PNG frames keep the alpha channel; JPEG would flatten it onto black.
Config.setVideoImageFormat('png')
Config.setOverwriteOutput(true)

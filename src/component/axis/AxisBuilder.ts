/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import {
    retrieve, defaults, extend, each, isObject, map, isString, isNumber, isFunction, retrieve2,
} from 'zrender/src/core/util';
import * as graphic from '../../util/graphic';
import {getECData} from '../../util/innerStore';
import {createTextStyle} from '../../label/labelStyle';
import Model from '../../model/Model';
import {isRadianAroundZero, remRadian} from '../../util/number';
import {createSymbol, normalizeSymbolOffset} from '../../util/symbol';
import * as matrixUtil from 'zrender/src/core/matrix';
import {applyTransform as v2ApplyTransform} from 'zrender/src/core/vector';
import {isNameLocationCenter, shouldShowAllLabels} from '../../coord/axisHelper';
import { AxisBaseModel } from '../../coord/AxisBaseModel';
import {
    ZRTextVerticalAlign, ZRTextAlign, ECElement, ColorString,
    VisualAxisBreak,
    ParsedAxisBreak,
    LabelMarginType,
    LabelExtendedText,
} from '../../util/types';
import { AxisBaseOption } from '../../coord/axisCommonTypes';
import type Element from 'zrender/src/Element';
import { PathProps, PathStyleProps } from 'zrender/src/graphic/Path';
import OrdinalScale from '../../scale/Ordinal';
import {
    prepareLayoutList, hideOverlap, detectAxisLabelPairIntersection,
} from '../../label/labelLayoutHelper';
import ExtensionAPI from '../../core/ExtensionAPI';
import CartesianAxisModel from '../../coord/cartesian/AxisModel';
import { makeInner } from '../../util/model';
import { getAxisBreakHelper } from './axisBreakHelper';
import { AXIS_BREAK_EXPAND_ACTION_TYPE, BaseAxisBreakPayload } from './axisAction';
import { getScaleBreakHelper } from '../../scale/break';
import { addEditorInfo } from '../../util/editorInfo';

const PI = Math.PI;

type AxisIndexKey = 'xAxisIndex' | 'yAxisIndex' | 'radiusAxisIndex'
    | 'angleAxisIndex' | 'singleAxisIndex';

type AxisEventData = {
    componentType: string
    componentIndex: number
    targetType: 'axisName' | 'axisLabel'
    name?: string
    value?: string | number
    dataIndex?: number
    tickIndex?: number
} & {
    break?: {
        start: ParsedAxisBreak['vmin'],
        end: ParsedAxisBreak['vmax'],
    }
} & {
    [key in AxisIndexKey]?: number
};

type AxisLabelText = graphic.Text & {
    __fullText: string
    __truncatedText: string
} & ECElement;

const getLabelInner = makeInner<{
    break: VisualAxisBreak;
}, graphic.Text>();


export interface AxisBuilderCfg {
    position?: number[]
    /**
     * In radian. This is to be applied to axis transitionGroup directly.
     * rotation 0 means an axis towards screen-right.
     * rotation Math.PI/4 means an axis towards screen-top-right.
     */
    rotation?: number
    /**
     * Used when nameLocation is 'middle' or 'center'.
     * 1 | -1
     */
    nameDirection?: number
    tickDirection?: number
    labelDirection?: number
    /**
     * Useful when onZero.
     */
    labelOffset?: number
    /**
     * default get from axisModel.
     */
    axisLabelShow?: boolean
    /**
     * default get from axisModel.
     */
    axisName?: string

    axisNameAvailableWidth?: number
    /**
     * by degree, default get from axisModel.
     */
    labelRotate?: number

    strokeContainThreshold?: number

    nameTruncateMaxWidth?: number

    silent?: boolean

    handleAutoShown?(elementType: 'axisLine' | 'axisTick'): boolean
}

interface TickCoord {
    coord: number
    tickValue?: number
}

/**
 * A final axis is translated and rotated from a "standard axis".
 * So opt.position and opt.rotation is required.
 *
 * A standard axis is and axis from [0, 0] to [0, axisExtent[1]],
 * for example: (0, 0) ------------> (0, 50)
 *
 * nameDirection or tickDirection or labelDirection is 1 means tick
 * or label is below the standard axis, whereas is -1 means above
 * the standard axis. labelOffset means offset between label and axis,
 * which is useful when 'onZero', where axisLabel is in the grid and
 * label in outside grid.
 *
 * Tips: like always,
 * positive rotation represents anticlockwise, and negative rotation
 * represents clockwise.
 * The direction of position coordinate is the same as the direction
 * of screen coordinate.
 *
 * Do not need to consider axis 'inverse', which is auto processed by
 * axis extent.
 */
class AxisBuilder {

    axisModel: AxisBaseModel;

    opt: AxisBuilderCfg;

    readonly group = new graphic.Group();

    private _transformGroup: graphic.Group;
    private _api: ExtensionAPI;

    constructor(
        axisModel: AxisBaseModel,
        api: ExtensionAPI,
        opt?: AxisBuilderCfg
    ) {
        this._api = api;
        this.opt = opt;

        this.axisModel = axisModel;

        // Default value
        defaults(
            opt,
            {
                labelOffset: 0,
                nameDirection: 1,
                tickDirection: 1,
                labelDirection: 1,
                silent: true,
                handleAutoShown: () => true
            } as AxisBuilderCfg
        );


        // FIXME Not use a separate text group?
        const transformGroup = new graphic.Group({
            x: opt.position[0],
            y: opt.position[1],
            rotation: opt.rotation
        });

        // this.group.add(transformGroup);
        // this._transformGroup = transformGroup;

        transformGroup.updateTransform();

        this._transformGroup = transformGroup;
    }

    hasBuilder(name: keyof typeof builders) {
        return !!builders[name];
    }

    add(name: keyof typeof builders) {
        builders[name](this.opt, this.axisModel, this.group, this._transformGroup, this._api);
    }

    getGroup() {
        return this.group;
    }

    static innerTextLayout(axisRotation: number, textRotation: number, direction: number) {
        const rotationDiff = remRadian(textRotation - axisRotation);
        let textAlign;
        let textVerticalAlign;

        if (isRadianAroundZero(rotationDiff)) { // Label is parallel with axis line.
            textVerticalAlign = direction > 0 ? 'top' : 'bottom';
            textAlign = 'center';
        }
        else if (isRadianAroundZero(rotationDiff - PI)) { // Label is inverse parallel with axis line.
            textVerticalAlign = direction > 0 ? 'bottom' : 'top';
            textAlign = 'center';
        }
        else {
            textVerticalAlign = 'middle';

            if (rotationDiff > 0 && rotationDiff < PI) {
                textAlign = direction > 0 ? 'right' : 'left';
            }
            else {
                textAlign = direction > 0 ? 'left' : 'right';
            }
        }

        return {
            rotation: rotationDiff,
            textAlign: textAlign as ZRTextAlign,
            textVerticalAlign: textVerticalAlign as ZRTextVerticalAlign
        };
    }

    static makeAxisEventDataBase(axisModel: AxisBaseModel) {
        const eventData = {
            componentType: axisModel.mainType,
            componentIndex: axisModel.componentIndex
        } as AxisEventData;
        eventData[axisModel.mainType + 'Index' as AxisIndexKey] = axisModel.componentIndex;
        return eventData;
    }

    static isLabelSilent(axisModel: AxisBaseModel): boolean {
        const tooltipOpt = axisModel.get('tooltip');
        return axisModel.get('silent')
            // Consider mouse cursor, add these restrictions.
            || !(
                axisModel.get('triggerEvent') || (tooltipOpt && tooltipOpt.show)
            );
    }
};

interface AxisElementsBuilder {
    (
        opt: AxisBuilderCfg,
        axisModel: AxisBaseModel,
        group: graphic.Group,
        transformGroup: graphic.Group,
        api: ExtensionAPI
    ):void
}

const builders: Record<'axisLine' | 'axisTickLabel' | 'axisName', AxisElementsBuilder> = {

    axisLine(opt, axisModel, group, transformGroup, api) {

        let shown = axisModel.get(['axisLine', 'show']);
        if (shown === 'auto' && opt.handleAutoShown) {
            shown = opt.handleAutoShown('axisLine');
        }
        if (!shown) {
            return;
        }

        const extent = axisModel.axis.getExtent();

        const matrix = transformGroup.transform;
        const pt1 = [extent[0], 0];
        const pt2 = [extent[1], 0];
        const inverse = pt1[0] > pt2[0];
        if (matrix) {
            v2ApplyTransform(pt1, pt1, matrix);
            v2ApplyTransform(pt2, pt2, matrix);
        }

        const lineStyle = extend(
            {
                lineCap: 'round'
            },
            axisModel.getModel(['axisLine', 'lineStyle']).getLineStyle()
        );
        const pathBaseProp: PathProps = {
            strokeContainThreshold: opt.strokeContainThreshold || 5,
            silent: true,
            z2: 1,
            style: lineStyle,
        };

        if (axisModel.get(['axisLine', 'breakLine']) && axisModel.axis.scale.hasBreaks()) {
            getAxisBreakHelper()!.buildAxisBreakLine(axisModel, group, transformGroup, pathBaseProp);
        }
        else {
            const line = new graphic.Line(extend({
                shape: {
                    x1: pt1[0],
                    y1: pt1[1],
                    x2: pt2[0],
                    y2: pt2[1]
                },
            }, pathBaseProp));
            if (__EDITOR__) {
                addEditorInfo(line, {
                    component: axisModel.mainType,
                    componentIndex: axisModel.componentIndex,
                    subType: axisModel.subType,
                    element: 'axisLine'
                });
            }
            graphic.subPixelOptimizeLine(line.shape, line.style.lineWidth);
            line.anid = 'line';
            group.add(line);
        }

        let arrows = axisModel.get(['axisLine', 'symbol']);

        if (arrows != null) {
            let arrowSize = axisModel.get(['axisLine', 'symbolSize']);

            if (isString(arrows)) {
                // Use the same arrow for start and end point
                arrows = [arrows, arrows];
            }
            if (isString(arrowSize) || isNumber(arrowSize)) {
                // Use the same size for width and height
                arrowSize = [arrowSize as number, arrowSize as number];
            }

            const arrowOffset = normalizeSymbolOffset(axisModel.get(['axisLine', 'symbolOffset']) || 0, arrowSize);

            const symbolWidth = arrowSize[0];
            const symbolHeight = arrowSize[1];

            each([{
                rotate: opt.rotation + Math.PI / 2,
                offset: arrowOffset[0],
                r: 0
            }, {
                rotate: opt.rotation - Math.PI / 2,
                offset: arrowOffset[1],
                r: Math.sqrt((pt1[0] - pt2[0]) * (pt1[0] - pt2[0])
                    + (pt1[1] - pt2[1]) * (pt1[1] - pt2[1]))
            }], function (point, index) {
                if (arrows[index] !== 'none' && arrows[index] != null) {
                    const symbol = createSymbol(
                        arrows[index],
                        -symbolWidth / 2,
                        -symbolHeight / 2,
                        symbolWidth,
                        symbolHeight,
                        lineStyle.stroke,
                        true
                    );

                    // Calculate arrow position with offset
                    const r = point.r + point.offset;

                    const pt = inverse ? pt2 : pt1;
                    symbol.attr({
                        rotation: point.rotate,
                        x: pt[0] + r * Math.cos(opt.rotation),
                        y: pt[1] - r * Math.sin(opt.rotation),
                        silent: true,
                        z2: 11
                    });
                    if (__EDITOR__) {
                        addEditorInfo(symbol, {
                            component: axisModel.mainType,
                            componentIndex: axisModel.componentIndex,
                            subType: axisModel.subType,
                            element: 'axisLineSymbol'
                        });
                    }
                    group.add(symbol);
                }
            });
        }
    },

    axisTickLabel(opt, axisModel, group, transformGroup, api) {
        const ticksEls = buildAxisMajorTicks(group, transformGroup, axisModel, opt);
        const labelEls = buildAxisLabel(group, transformGroup, axisModel, opt, api);

        adjustBreakLabels(axisModel, opt.rotation, labelEls);

        const shouldHideOverlap = axisModel.get(['axisLabel', 'hideOverlap']);

        fixMinMaxLabelShow(opt, axisModel, labelEls, ticksEls, shouldHideOverlap);

        buildAxisMinorTicks(group, transformGroup, axisModel, opt.tickDirection);

        // This bit fixes the label overlap issue for the time chart.
        // See https://github.com/apache/echarts/issues/14266 for more.
        if (shouldHideOverlap) {
            let priorityBoundary = 0;
            each(labelEls, label => {
                label.z2 > priorityBoundary && (priorityBoundary = label.z2);
            });
            const labelList = prepareLayoutList(map(labelEls, label => {
                let priority = label.z2;
                if (getLabelInner(label).break) {
                    // Make break labels be highest priority.
                    priority += priorityBoundary;
                }
                return {
                    label,
                    priority,
                    defaultAttr: {
                        ignore: label.ignore
                    },
                };
            }));

            hideOverlap(labelList);
        }
    },

    axisName(opt, axisModel, group, transformGroup, api) {
        const name = retrieve(opt.axisName, axisModel.get('name'));

        if (!name) {
            return;
        }

        const nameLocation = axisModel.get('nameLocation');
        const nameDirection = opt.nameDirection;
        const textStyleModel = axisModel.getModel('nameTextStyle');
        const axisToNameGapStartGap = axisModel instanceof CartesianAxisModel ? axisModel.axisToNameGapStartGap : 0;
        const gap = (axisModel.get('nameGap') || 0) + axisToNameGapStartGap;

        const extent = axisModel.axis.getExtent();
        const gapSignal = extent[0] > extent[1] ? -1 : 1;
        const pos = [
            nameLocation === 'start'
                ? extent[0] - gapSignal * gap
                : nameLocation === 'end'
                ? extent[1] + gapSignal * gap
                : (extent[0] + extent[1]) / 2, // 'middle'
            // Reuse labelOffset.
            isNameLocationCenter(nameLocation) ? opt.labelOffset + nameDirection * gap : 0
        ];

        let labelLayout;

        let nameRotation = axisModel.get('nameRotate');
        if (nameRotation != null) {
            nameRotation = nameRotation * PI / 180; // To radian.
        }

        let axisNameAvailableWidth;

        if (isNameLocationCenter(nameLocation)) {
            labelLayout = AxisBuilder.innerTextLayout(
                opt.rotation,
                nameRotation != null ? nameRotation : opt.rotation, // Adapt to axis.
                nameDirection
            );
        }
        else {
            labelLayout = endTextLayout(
                opt.rotation, nameLocation, nameRotation || 0, extent
            );

            axisNameAvailableWidth = opt.axisNameAvailableWidth;
            if (axisNameAvailableWidth != null) {
                axisNameAvailableWidth = Math.abs(
                    axisNameAvailableWidth / Math.sin(labelLayout.rotation)
                );
                !isFinite(axisNameAvailableWidth) && (axisNameAvailableWidth = null);
            }
        }

        const textFont = textStyleModel.getFont();

        const truncateOpt = axisModel.get('nameTruncate', true) || {};
        const ellipsis = truncateOpt.ellipsis;
        const maxWidth = retrieve(
            opt.nameTruncateMaxWidth, truncateOpt.maxWidth, axisNameAvailableWidth
        );

        const textEl = new graphic.Text({
            x: pos[0],
            y: pos[1],
            rotation: labelLayout.rotation,
            silent: AxisBuilder.isLabelSilent(axisModel),
            style: createTextStyle(textStyleModel, {
                text: name,
                font: textFont,
                overflow: 'truncate',
                width: maxWidth,
                ellipsis,
                fill: textStyleModel.getTextColor()
                    || axisModel.get(['axisLine', 'lineStyle', 'color']) as ColorString,
                align: textStyleModel.get('align')
                    || labelLayout.textAlign,
                verticalAlign: textStyleModel.get('verticalAlign')
                    || labelLayout.textVerticalAlign
            }),
            z2: 1
        }) as AxisLabelText;

        if (__EDITOR__) {
            addEditorInfo(textEl, {
                component: axisModel.mainType,
                element: 'axisName',
                componentIndex: axisModel.componentIndex,
                subType: axisModel.subType
            });
        }
        graphic.setTooltipConfig({
            el: textEl,
            componentModel: axisModel,
            itemName: name
        });

        textEl.__fullText = name;
        // Id for animation
        textEl.anid = 'name';

        if (axisModel.get('triggerEvent')) {
            const eventData = AxisBuilder.makeAxisEventDataBase(axisModel);
            eventData.targetType = 'axisName';
            eventData.name = name;
            getECData(textEl).eventData = eventData;
        }

        // FIXME
        transformGroup.add(textEl);
        textEl.updateTransform();

        group.add(textEl);

        textEl.decomposeTransform();
    }

};

function endTextLayout(
    rotation: number, textPosition: 'start' | 'middle' | 'end', textRotate: number, extent: number[]
) {
    const rotationDiff = remRadian(textRotate - rotation);
    let textAlign: ZRTextAlign;
    let textVerticalAlign: ZRTextVerticalAlign;
    const inverse = extent[0] > extent[1];
    const onLeft = (textPosition === 'start' && !inverse)
        || (textPosition !== 'start' && inverse);

    if (isRadianAroundZero(rotationDiff - PI / 2)) {
        textVerticalAlign = onLeft ? 'bottom' : 'top';
        textAlign = 'center';
    }
    else if (isRadianAroundZero(rotationDiff - PI * 1.5)) {
        textVerticalAlign = onLeft ? 'top' : 'bottom';
        textAlign = 'center';
    }
    else {
        textVerticalAlign = 'middle';
        if (rotationDiff < PI * 1.5 && rotationDiff > PI / 2) {
            textAlign = onLeft ? 'left' : 'right';
        }
        else {
            textAlign = onLeft ? 'right' : 'left';
        }
    }

    return {
        rotation: rotationDiff,
        textAlign: textAlign,
        textVerticalAlign: textVerticalAlign
    };
}

function fixMinMaxLabelShow(
    opt: AxisBuilderCfg,
    axisModel: AxisBaseModel,
    labelEls: graphic.Text[],
    tickEls: graphic.Line[],
    shouldHideOverlap: boolean
) {
    if (shouldShowAllLabels(axisModel.axis)) {
        return;
    }

    // If min or max are user set, we need to check
    // If the tick on min(max) are overlap on their neighbour tick
    // If they are overlapped, we need to hide the min(max) tick label
    const showMinLabel = axisModel.get(['axisLabel', 'showMinLabel']);
    const showMaxLabel = axisModel.get(['axisLabel', 'showMaxLabel']);

    // FIXME
    // Have not consider onBand yet, where tick els is more than label els.

    labelEls = labelEls || [];
    tickEls = tickEls || [];

    const firstLabel = labelEls[0];
    const nextLabel = labelEls[1];
    const lastLabel = labelEls[labelEls.length - 1];
    const prevLabel = labelEls[labelEls.length - 2];

    const firstTick = tickEls[0];
    const nextTick = tickEls[1];
    const lastTick = tickEls[tickEls.length - 1];
    const prevTick = tickEls[tickEls.length - 2];

    // In most fonts the glyph does not reach the boundary of the bouding rect.
    // This is needed to avoid too aggressive to hide two elements that meet at the edge
    // due to compact layout by the same bounding rect or OBB.
    const touchThreshold = 0.05;
    // `!hideOverlap` means the visual touch between adjacent labels are accepted,
    // thus the "hide min/max label" should be conservative, since the space is sufficient
    // in this case. And this strategy is also for backward compatibility.
    const ignoreTextMargin = !shouldHideOverlap;

    if (showMinLabel === false) {
        ignoreEl(firstLabel);
        ignoreEl(firstTick);
    }
    else if (detectAxisLabelPairIntersection(
        opt.rotation, [firstLabel, nextLabel], touchThreshold, ignoreTextMargin
    )) {
        if (showMinLabel) {
            ignoreEl(nextLabel);
            ignoreEl(nextTick);
        }
        else {
            ignoreEl(firstLabel);
            ignoreEl(firstTick);
        }
    }

    if (showMaxLabel === false) {
        ignoreEl(lastLabel);
        ignoreEl(lastTick);
    }
    else if (detectAxisLabelPairIntersection(
        opt.rotation, [prevLabel, lastLabel], touchThreshold, ignoreTextMargin
    )) {
        if (showMaxLabel) {
            ignoreEl(prevLabel);
            ignoreEl(prevTick);
        }
        else {
            ignoreEl(lastLabel);
            ignoreEl(lastTick);
        }
    }
}

function ignoreEl(el: Element) {
    el && (el.ignore = true);
}

function createTicks(
    ticksCoords: TickCoord[],
    tickTransform: matrixUtil.MatrixArray,
    tickEndCoord: number,
    tickLineStyle: PathStyleProps,
    anidPrefix: string
) {
    const tickEls = [];
    const pt1: number[] = [];
    const pt2: number[] = [];
    for (let i = 0; i < ticksCoords.length; i++) {
        const tickCoord = ticksCoords[i].coord;

        pt1[0] = tickCoord;
        pt1[1] = 0;
        pt2[0] = tickCoord;
        pt2[1] = tickEndCoord;

        if (tickTransform) {
            v2ApplyTransform(pt1, pt1, tickTransform);
            v2ApplyTransform(pt2, pt2, tickTransform);
        }
        // Tick line, Not use group transform to have better line draw
        const tickEl = new graphic.Line({
            shape: {
                x1: pt1[0],
                y1: pt1[1],
                x2: pt2[0],
                y2: pt2[1]
            },
            style: tickLineStyle,
            z2: 2,
            autoBatch: true,
            silent: true
        });
        graphic.subPixelOptimizeLine(tickEl.shape, tickEl.style.lineWidth);
        tickEl.anid = anidPrefix + '_' + ticksCoords[i].tickValue;
        tickEls.push(tickEl);
    }
    return tickEls;
}

function buildAxisMajorTicks(
    group: graphic.Group,
    transformGroup: graphic.Group,
    axisModel: AxisBaseModel,
    opt: AxisBuilderCfg
) {
    const axis = axisModel.axis;

    const tickModel = axisModel.getModel('axisTick');

    let shown = tickModel.get('show');
    if (shown === 'auto' && opt.handleAutoShown) {
        shown = opt.handleAutoShown('axisTick');
    }
    if (!shown || axis.scale.isBlank()) {
        return;
    }

    const lineStyleModel = tickModel.getModel('lineStyle');
    const tickEndCoord = opt.tickDirection * tickModel.get('length');

    const ticksCoords = axis.getTicksCoords();

    const ticksEls = createTicks(ticksCoords, transformGroup.transform, tickEndCoord, defaults(
        lineStyleModel.getLineStyle(),
        {
            stroke: axisModel.get(['axisLine', 'lineStyle', 'color'])
        }
    ), 'ticks');

    for (let i = 0; i < ticksEls.length; i++) {
        if (__EDITOR__) {
            addEditorInfo(ticksEls[i], {
                component: axisModel.mainType,
                componentIndex: axisModel.componentIndex,
                subType: axisModel.subType,
                element: 'majorTicks'
            });
        }
        group.add(ticksEls[i]);
    }

    return ticksEls;
}

function buildAxisMinorTicks(
    group: graphic.Group,
    transformGroup: graphic.Group,
    axisModel: AxisBaseModel,
    tickDirection: number
) {
    const axis = axisModel.axis;

    const minorTickModel = axisModel.getModel('minorTick');

    if (!minorTickModel.get('show') || axis.scale.isBlank()) {
        return;
    }

    const minorTicksCoords = axis.getMinorTicksCoords();
    if (!minorTicksCoords.length) {
        return;
    }

    const lineStyleModel = minorTickModel.getModel('lineStyle');
    const tickEndCoord = tickDirection * minorTickModel.get('length');

    const minorTickLineStyle = defaults(
        lineStyleModel.getLineStyle(),
        defaults(
            axisModel.getModel('axisTick').getLineStyle(),
            {
                stroke: axisModel.get(['axisLine', 'lineStyle', 'color'])
            }
        )
    );

    for (let i = 0; i < minorTicksCoords.length; i++) {
        const minorTicksEls = createTicks(
            minorTicksCoords[i], transformGroup.transform, tickEndCoord, minorTickLineStyle, 'minorticks_' + i
        );
        for (let k = 0; k < minorTicksEls.length; k++) {
            if (__EDITOR__) {
                addEditorInfo(minorTicksEls[k], {
                    component: axisModel.mainType,
                    element: 'minorTicks',
                    componentIndex: axisModel.componentIndex,
                    subType: axisModel.subType
                });
            }
            group.add(minorTicksEls[k]);
        }
    }
}

function buildAxisLabel(
    group: graphic.Group,
    transformGroup: graphic.Group,
    axisModel: AxisBaseModel,
    opt: AxisBuilderCfg,
    api: ExtensionAPI
): graphic.Text[] {
    const axis = axisModel.axis;
    const show = retrieve(opt.axisLabelShow, axisModel.get(['axisLabel', 'show']));

    if (!show || axis.scale.isBlank()) {
        return [];
    }

    const labelModel = axisModel.getModel('axisLabel');
    const labelMargin = labelModel.get('margin');
    const labels = axis.getViewLabels();

    // Special label rotate.
    const labelRotation = (
        retrieve(opt.labelRotate, labelModel.get('rotate')) || 0
    ) * PI / 180;

    const labelLayout = AxisBuilder.innerTextLayout(opt.rotation, labelRotation, opt.labelDirection);
    const rawCategoryData = axisModel.getCategories && axisModel.getCategories(true);

    const labelEls: graphic.Text[] = [];
    const silent = AxisBuilder.isLabelSilent(axisModel);
    const triggerEvent = axisModel.get('triggerEvent');

    each(labels, function (labelItem, index) {
        const tickValue = axis.scale.type === 'ordinal'
            ? (axis.scale as OrdinalScale).getRawOrdinalNumber(labelItem.tickValue)
            : labelItem.tickValue;
        const formattedLabel = labelItem.formattedLabel;
        const rawLabel = labelItem.rawLabel;

        let itemLabelModel = labelModel;
        if (rawCategoryData && rawCategoryData[tickValue]) {
            const rawCategoryItem = rawCategoryData[tickValue];
            if (isObject(rawCategoryItem) && rawCategoryItem.textStyle) {
                itemLabelModel = new Model(
                    rawCategoryItem.textStyle, labelModel, axisModel.ecModel
                );
            }
        }

        const textColor = itemLabelModel.getTextColor() as AxisBaseOption['axisLabel']['color']
            || axisModel.get(['axisLine', 'lineStyle', 'color']);

        const tickCoord = axis.dataToCoord(tickValue);

        const align = itemLabelModel.getShallow('align', true)
            || labelLayout.textAlign;
        const alignMin = retrieve2(
            itemLabelModel.getShallow('alignMinLabel', true),
            align
        );
        const alignMax = retrieve2(
            itemLabelModel.getShallow('alignMaxLabel', true),
            align
        );

        const verticalAlign = itemLabelModel.getShallow('verticalAlign', true)
            || itemLabelModel.getShallow('baseline', true)
            || labelLayout.textVerticalAlign;
        const verticalAlignMin = retrieve2(
            itemLabelModel.getShallow('verticalAlignMinLabel', true),
            verticalAlign
        );
        const verticalAlignMax = retrieve2(
            itemLabelModel.getShallow('verticalAlignMaxLabel', true),
            verticalAlign
        );

        const textEl = new graphic.Text({
            x: tickCoord,
            y: opt.labelOffset + opt.labelDirection * labelMargin,
            rotation: labelLayout.rotation,
            silent: silent,
            z2: 10 + (labelItem.time?.level || 0),
            style: createTextStyle(itemLabelModel, {
                text: formattedLabel,
                align: index === 0
                    ? alignMin
                    : index === labels.length - 1 ? alignMax : align,
                verticalAlign: index === 0
                    ? verticalAlignMin
                    : index === labels.length - 1 ? verticalAlignMax : verticalAlign,
                fill: isFunction(textColor)
                    ? textColor(
                        // (1) In category axis with data zoom, tick is not the original
                        // index of axis.data. So tick should not be exposed to user
                        // in category axis.
                        // (2) Compatible with previous version, which always use formatted label as
                        // input. But in interval scale the formatted label is like '223,445', which
                        // maked user replace ','. So we modify it to return original val but remain
                        // it as 'string' to avoid error in replacing.
                        axis.type === 'category'
                            ? rawLabel
                            : axis.type === 'value'
                            ? tickValue + ''
                            : tickValue,
                        index
                    )
                    : textColor as string,
                margin: itemLabelModel.get('textMargin', true),
            })
        });
        (textEl as LabelExtendedText).__marginType = LabelMarginType.textMargin;

        if (__EDITOR__) {
            addEditorInfo(textEl, {
                element: 'axisLabel',
                component: axisModel.mainType,
                componentIndex: axisModel.componentIndex,
                subType: axisModel.subType
            });
        }
        textEl.anid = 'label_' + tickValue;

        getLabelInner(textEl).break = labelItem.break;

        graphic.setTooltipConfig({
            el: textEl,
            componentModel: axisModel,
            itemName: formattedLabel,
            formatterParamsExtra: {
                isTruncated: () => textEl.isTruncated,
                value: rawLabel,
                tickIndex: index
            }
        });

        // Pack data for mouse event
        if (triggerEvent) {
            const eventData = AxisBuilder.makeAxisEventDataBase(axisModel);
            eventData.targetType = 'axisLabel';
            eventData.value = rawLabel;
            eventData.tickIndex = index;
            if (labelItem.break) {
                eventData.break = {
                    // type: labelItem.break.type,
                    start: labelItem.break.parsedBreak.vmin,
                    end: labelItem.break.parsedBreak.vmax,
                };
            }
            if (axis.type === 'category') {
                eventData.dataIndex = tickValue;
            }

            getECData(textEl).eventData = eventData;

            if (labelItem.break) {
                addBreakEventHandler(axisModel, api, textEl, labelItem.break);
            }
        }

        // FIXME
        transformGroup.add(textEl);
        textEl.updateTransform();

        labelEls.push(textEl);
        group.add(textEl);

        textEl.decomposeTransform();

    });

    return labelEls;
}

function addBreakEventHandler(
    axisModel: AxisBaseModel,
    api: ExtensionAPI,
    textEl: graphic.Text,
    visualBreak: VisualAxisBreak
): void {
    textEl.on('click', params => {
        const payload: BaseAxisBreakPayload = {
            type: AXIS_BREAK_EXPAND_ACTION_TYPE,
            breaks: [{
                start: visualBreak.parsedBreak.breakOption.start,
                end: visualBreak.parsedBreak.breakOption.end,
            }]
        };
        payload[`${axisModel.axis.dim}AxisIndex`] = axisModel.componentIndex;
        api.dispatchAction(payload);
    });
}

function adjustBreakLabels(
    axisModel: AxisBaseModel,
    axisRotation: AxisBuilderCfg['rotation'],
    labelEls: graphic.Text[]
): void {
    const scaleBreakHelper = getScaleBreakHelper();
    if (!scaleBreakHelper) {
        return;
    }
    const breakLabelPairs = scaleBreakHelper.retrieveAxisBreakPairs(labelEls, el => getLabelInner(el).break);
    const moveOverlap = axisModel.get(['breakLabelLayout', 'moveOverlap'], true);
    if (moveOverlap === true || moveOverlap === 'auto') {
        each(breakLabelPairs, pair =>
            getAxisBreakHelper()!.adjustBreakLabelPair(axisModel.axis.inverse, axisRotation, pair)
        );
    }
}

export default AxisBuilder;
